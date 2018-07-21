
'use strict'

const Promise = require("bluebird");
const PATH = require("path");
const FS = require("fs-extra");
Promise.promisifyAll(FS);
FS.existsAsync = function (path) {
    return new Promise(function (resolve) {
        return FS.exists(path, resolve);
    });
}
const MINIMIST = require("minimist");
const LODASH_MERGE = require("lodash/merge");
const LODASH_VALUES = require("lodash/values");
const LODASH_DEBOUNCE = require("lodash/debounce");
const DEEPDIFF = require("deep-object-diff");
const INTERNAL_IP = require('internal-ip');
const CHILD_PROCESS = require("child_process");
Promise.promisifyAll(CHILD_PROCESS);
const SPAWN = CHILD_PROCESS.spawn;
const NET = require("net");
const EventEmitter = require('events');
const PEM = require('pem');
Promise.promisifyAll(PEM);
const JWT = require('jsonwebtoken');
Promise.promisifyAll(JWT);

const PM2 = require('pm2');
Promise.promisifyAll(PM2);

const IPFS = require('ipfs');
// https://github.com/ipfs-shipyard/ipfs-pubsub-room
const Room = require('ipfs-pubsub-room');
const PeerId = require('peer-id');
Promise.promisifyAll(PeerId);
// https://github.com/libp2p/js-peer-info
const PeerInfo = require('peer-info');
Promise.promisifyAll(PeerInfo);
// https://github.com/multiformats/multiaddr
const libp2p = require('libp2p');
const TCP = require('libp2p-tcp');
const SPDY = require('libp2p-spdy');
const Mplex = require('libp2p-mplex');
const SECIO = require('libp2p-secio');
const pull = require('pull-stream');
const defaultsDeep = require('@nodeutils/defaults-deep');
const MulticastDNS = require('libp2p-mdns');
const Pushable = require('pull-pushable');
const toStream = require('pull-stream-to-stream');
// https://github.com/libp2p/js-libp2p-websocket-star-rendezvous
//const RENDEZVOUS = require('libp2p-websocket-star-rendezvous');
//const multiaddr = require('multiaddr');

// ####################################################################################################
// # Main
// ####################################################################################################

var LOCAL_NETWORK_IP = "";
function log () {
    var args = Array.from(arguments);
    args.unshift("[herd][" + LOCAL_NETWORK_IP + "]");
    console.log.apply(console, args);
}

setImmediate(function () {
    if (require.main === module) {
        async function main () {
            try {
                await CLI.RunForArgs(MINIMIST(process.argv.slice(2), {
                    boolean: [
                        "daemonize"
                    ]
                }));
            } catch (err) {
                console.error("[herd]", err);
                process.exit(1);
            }
        }
        main();
    }    
});

// ####################################################################################################
// # Classes
// ####################################################################################################

class CLI {

    static async RunForArgs (args) {

        let node = await Node.ForNamespace(args.ns || "default");
        let herd = await Herd.ForNode(node);

        function network () {
            return new HerdNetwork(herd);
        }

        async function start (bootstrapAddress) {
            if (bootstrapAddress) {
                await herd.updateBootstrapAddress(bootstrapAddress);
            }
            if (args.daemonize) {
                await herd.startNodeProcess();
            } else {
                await network().start();
            }
        }

        if (args.help) {
            console.log("Usage: herd");
            console.log("  bootstrap [--daemonize] <address>");
            console.log("  run [--daemonize]");
            console.log("  show");
            console.log("  add <user@server>");
            return;
        }
        
        switch (args._[0]) {

            case 'bootstrap':
                await start(args._[1]);
                break;

            case 'run':
                await start();
                break;

            case 'show':
                await herd.show();
                break;

            case 'add':
                await herd.addNode(args._[1], await herd.ensureMasterNode());
                break;

            default:
                args.daemonize = true;
                await start();
                break
        }
    }
}

// ####################################################################################################

class Node {

    static async ForNamespace (namespace) {
        let node = new Node(namespace);
        await node.init();
        return node;
    }

    constructor (namespace) {
        let self = this;

        self.namespace = namespace;
        self.homePath = PATH.join(process.env.HOME, ".io.pinf", "herd", "herds", namespace);
        self.peerIdPath = PATH.join(self.homePath, ".node.peer.id");
    }

    async init () {
        let self = this;

        if (!await FS.existsAsync(self.homePath)) {
            await FS.mkdirsAsync(self.homePath);
        }

        if (!await FS.existsAsync(self.peerIdPath)) {

            self.peerId = await PeerId.createAsync({
                bits: 1024
            });

            await FS.writeFileAsync(self.peerIdPath, JSON.stringify(self.peerId.toJSON(), null, 4), "utf8");
        } else {
            let info = await FS.readFileAsync(self.peerIdPath, "utf8");

            self.peerId = await PeerId.createFromJSONAsync(JSON.parse(info));    
        }

        self.peerIdString = self.peerId.toB58String();
        
        self.peerInfo = await PeerInfo.createAsync(self.peerId);

        self.localNetworkIP = await INTERNAL_IP.v4();
        LOCAL_NETWORK_IP = self.localNetworkIP;

        self.uname = (await CHILD_PROCESS.execAsync("uname -a")).toString();
    }
}

class Herd extends EventEmitter {

    static async ForNode (node) {
        let herd = new Herd(node);
        await herd.init();
        return herd;
    }

    constructor (node) {
        super();
        let self = this;

        self.node = node;
        self.version = require("./package.json").version;
        self.localNetworkBootstrapAddressPath = PATH.join(self.node.homePath, ".localnetwork.bootstrap.address");

        self.bootstrapAddressesPath = PATH.join(self.node.homePath, ".ipfsnetwork.bootstrap.addresses");

        self.privateKeyPath = PATH.join(self.node.homePath, ".shared.private.key");
    }

    async init () {
        let self = this;

        let exists = await FS.existsAsync(self.privateKeyPath);
        if (!exists) {
            log("[Herd] Generating shared private key for herd ...");
            self.privateKey = (await PEM.createPrivateKeyAsync(2048, { cipher:'aes256' })).key;
            await FS.outputFileAsync(self.privateKeyPath, self.privateKey, "utf8");
        } else {
            self.privateKey = await FS.readFileAsync(self.privateKeyPath, "utf8");
        }
        if ((await self._decryptMessage(self._encryptMessage({ test: 'success' }))).test !== 'success') {
            throw new Error("[Herd] Private key sanity check failed!");
        }

        self.bootstrapAddresses = (await FS.existsAsync(self.bootstrapAddressesPath) && JSON.parse(await FS.readFileAsync(self.bootstrapAddressesPath, "utf8") || "{}")) || {};

        self.nodes = {};
        var announceNodes = LODASH_DEBOUNCE(function () {
            log("[Herd] Nodes:", JSON.stringify(self.nodes.herd, null, 4));
        }, 5 * 1000);
        await Promise.mapSeries([
            "herd",
            "ipfsnetwork",
            "localbroadcastnetwork"
        ], async function (networkType) {

            let path = PATH.join(self.node.homePath, "." + networkType + ".nodes");
            let nodes = (await FS.existsAsync(path) && JSON.parse(await FS.readFileAsync(path, "utf8") || "{}")) || {};

            if (networkType !== "herd") {
                function forward (suffix) {
                    return function (data) {
                        self.emit("herd" + suffix, data);
                    }
                }
                self.on(networkType + ":start", forward(":start"));
                self.on(networkType + ":stop", forward(":stop"));
                self.on(networkType + ":node", forward(":node"));
            }

            function setDisconnected () {
                Object.keys(nodes).forEach(function (nodePeerId) {
                    nodes[nodePeerId].connected = false;
                });
            }
            self.on(networkType + ":start", setDisconnected);
            self.on(networkType + ":stop", setDisconnected);
            self.on(networkType + ":node", async function (node) {

                if (typeof node.localNetworkIP !== "undefined") {
                    node.isOurNode = (node.localNetworkIP === self.node.localNetworkIP);
                }

                if (self._updateNodesMapWithNode(nodes, node)) {

                    Object.keys(nodes).forEach(function (nodePeerId) {
                        if (nodes[nodePeerId].ipfsLocalNetworkBootstrapAddress) {
                            self.updateBootstrapAddress(nodes[nodePeerId].ipfsLocalNetworkBootstrapAddress);
                        }
                    });

                    await FS.writeFileAsync(path, JSON.stringify(nodes, null, 4), "utf8");

                    if (networkType === "herd") {
                        announceNodes();
                    }
                }
            });

            self.nodes[networkType] = nodes;
        });    
    }

    async updateBootstrapAddress (ipfsLocalNetworkBootstrapAddress) {
        let self = this;
        let ipfsPeerId = ipfsLocalNetworkBootstrapAddress.replace(/^.+\/ipfs\/([^\/]+)$/, "$1");
        if (
            ipfsLocalNetworkBootstrapAddress.indexOf("/ip4/" + self.node.localNetworkIP + "/") === 0 ||
            self.bootstrapAddresses[ipfsPeerId] === ipfsLocalNetworkBootstrapAddress
        ) {
            return;
        }
        self.bootstrapAddresses[ipfsPeerId] = ipfsLocalNetworkBootstrapAddress;
        await FS.writeFileAsync(self.bootstrapAddressesPath, JSON.stringify(self.bootstrapAddresses, null, 4), "utf8");

        self.emit("bootstrap:addresses", LODASH_VALUES(self.bootstrapAddresses));
    }

    async getLocalNetworkBootstrapAddress () {
        let self = this;
        let exists = await FS.existsAsync(self.localNetworkBootstrapAddressPath);
        if (!exists) return null;
        return FS.readFileAsync(self.localNetworkBootstrapAddressPath, "utf8");
    }

    async ensureMasterNode () {
        let self = this;

        let bootstrapAddress = null;

        async function connect () {

            bootstrapAddress = await self.getLocalNetworkBootstrapAddress();
            if (!bootstrapAddress) {
                return false;
            }

            return new Promise(function (resolve, reject) {
                // TODO: Use 'multiaddr'
                const client = NET.createConnection({
                    host: bootstrapAddress.replace(/.*\/ip4\/([^\/]+)\/.*/, "$1"),
                    port: parseInt(bootstrapAddress.replace(/.*\/tcp\/([^\/]+)\/.*/, "$1"))
                });
                client.setTimeout(3 * 1000);
                client.on('data', function (data) {
                    if (data.toString().indexOf("/multistream/1.") !== 1) {
                        return reject(new Error("Got incorrect handshake: " + data.toString()));
                    }
                    client.end();
                });
                client.on('error', reject);
                client.on('end', resolve);
            }).then(function () {
                return true;
            }).catch(function (err) {
                console.error("[Herd] Warning: Error when pinging herd node:", err.message);
                return false;
            });            
        }

        if (await connect()) {
            return bootstrapAddress;
        }

        log("[Herd] Herd node is NOT running. Starting herd ...");

        await self.startNodeProcess();

        return new Promise(function (resolve, reject) {
            var count = 0;
            var interval = setInterval(async function () {
                count++;
                if (await connect()) {
                    clearInterval(interval);
                    log("[Herd] Herd node now running");
                    return resolve(bootstrapAddress);
                }
                if (count > 10) {
                    clearInterval(interval);
                    return reject(new Error("[Herd] Timeout: Herd node not running after trying to start it!"));
                }
            }, 1000);
        });
    }

    async startNodeProcess () {
        let self = this;
        log("StartNodeProcess()");
        log("NOTE: To start io.pinf.herd on OS boot run 'sudo " + process.execPath + " " + self.node.homePath + "/node_modules/.bin/pm2 startup'");
        try {
            await PM2.connectAsync();
            await PM2.startAsync({
                cwd: __dirname,
                script: PATH.basename(__filename),
                name: 'io.pinf.herd',
                args: 'run',
                interpreter: process.execPath
            });
            PM2.disconnect();
        } catch (err) {
            console.error(err);
            process.exit(1);
        }
    }

    async addNode (clientUri, bootstrapAddress) {
        let self = this;

        function syncFile (name, path) {
            return new Promise(function (resolve, reject) {
    
                log("[Herd] Syncing script '" + name + "' to '" + clientUri + "' using scp");
    
                var proc = SPAWN("scp", [
                    '-q',
                    '-o LogLevel=QUIET',
                    '-o ConnectTimeout=5',
                    PATH.resolve(__dirname, path || name),
                    clientUri + ":~/.~io.pinf~" + name
                ], {
                    stdio: [
                        "ignore",
                        "inherit",
                        "inherit"
                    ]
                });
                proc.on('error', reject);
                proc.on('close', function (code) {
                    if (code !== 0) {
                        return reject(new Error("Process exited with code: " + code));
                    }
                    resolve(null);
                });
            });
        }
    
        return Promise.all([
            syncFile("herd.sh"),
            syncFile("herd.js"),
            syncFile("package.json"),
            syncFile("npm-shrinkwrap.json"),
            syncFile(PATH.basename(self.privateKeyPath), self.privateKeyPath)
        ]).then(function () {

            return new Promise(function (resolve, reject) {

                log("[Herd] Running shell script at '" + clientUri + "' using ssh");

                var proc = SPAWN("ssh", [
                    "-A",
                    clientUri,
                    'bash ~/.~io.pinf~herd.sh --namespace ' + self.node.namespace + ' remotestart ' + bootstrapAddress
                ], {
                    stdio: [
                        "ignore",
                        "pipe",
                        "inherit"
                    ]
                });
                proc.stdout.on("data", function (chunk) {
                    process.stdout.write(chunk);
                    if (/\[herd\.sh\] HERD NODE STARTED!/.test(chunk.toString())) {
                        proc.kill('SIGKILL');
                    }
                });
                proc.on('error', reject);
                proc.on('close', function (code) {
                    if (
                        code !== null &&
                        code !== 0
                    ) {
                        return reject(new Error("[Herd] Process exited with code: " + code));
                    }
                    resolve(null);
                });
            });
        });
    }    

    async show () {
        let self = this;
        if (Object.keys(self.nodes).length) {
            process.stdout.write(JSON.stringify(self.nodes, null, 4) + "\n");
        } else {
            process.stdout.write("[Herd] Node has never been started!\n");
        }
    }

    _encryptMessage (message) {
        return JWT.sign(message, this.privateKey);
    }

    async _decryptMessage (message) {
        try {
            return JWT.verifyAsync(message, this.privateKey);
        } catch (err) {
            throw new Error("[Herd] Error decrypting received message!");
        }
    }

    _updateNodesMapWithNode (nodes, node) {
        let self = this;
        if (!node.nodePeerId) {
            if (!node.ipfsPeerId) throw new Error("Node must specify 'nodePeerId' or 'ipfsPeerId'!");
            Object.keys(nodes).forEach(function (nodePeerId) {
                if (nodes[nodePeerId].ipfsPeerId === node.ipfsPeerId) {
                    node.nodePeerId = nodePeerId;
                }
            });
            if (!node.nodePeerId) throw new Error("Could not find node for ipfsPeerId '" + node.ipfsPeerId + "'!");
        }
        var diff = DEEPDIFF.detailedDiff(nodes[node.nodePeerId] || {}, node);
        if (
            !Object.keys(diff.added).length &&
            !Object.keys(diff.updated).length
        ) {
            // No changes
            return false;
        }
        if (node.localNetworkIP) {
            Object.keys(nodes).forEach(function (nodePeerId) {
                if (
                    nodes[nodePeerId].localNetworkIP === node.localNetworkIP &&
                    nodePeerId !== self.node.peerIdString
                ) {
                    delete nodes[nodePeerId];
                } else
                if (!nodes[nodePeerId].localNetworkIP) {
                    delete nodes[nodePeerId];
                }
            });
        }
        var obj = {};
        obj[node.nodePeerId] = node;
        LODASH_MERGE(nodes, obj);
        return true;
    }
}

class HerdNetwork {

    constructor (herd) {
        let self = this;

        self.herd = herd;

        self.localBordcastNetwork = new LocalBroadcastNetwork(self);
    }

    async start () {
        let self = this;

        console.log("|\n|\n|[Herd] ============================== START ==============================\n|\n|");
        
        self.herd.emit("ipfsnetwork:start");

        log("[HerdNetwork] localNetworkIP:", self.herd.node.localNetworkIP);
        log("[HerdNetwork] nodePeerId:", self.herd.node.peerIdString);

        await new Promise(function (resolve, reject) {

            // TODO: Disable mdns broadcast for local network and use 'localBordcastNetwork' to gather
            //       bootstrap addresses to connect to.
            //       This will prevent random IPFS nodes from connecting to our nodes by not being able to find them.

            var config = {
                repo: PATH.join(self.herd.node.homePath, "ipfs"),
                EXPERIMENTAL: {
                    pubsub: true
                },
                pass: self.herd.node.peerIdString,
                config: {
                    // List of ipfs peers that your daemon will connect to on startup.
                    // TODO: Get bootstrap address correct for slave nodes to connect to the master node that added them.
                    "Bootstrap": LODASH_VALUES(self.herd.bootstrapAddresses),//(bootstrapAddress && [ bootstrapAddress ]) || [],
                    "Addresses": {
                        // Addresses that the local daemon will listen on for connections from other ipfs peers.
                        // Ensure that these addresses can be dialed from a separate computer and that there are no firewalls blocking the ports you specify.
                        Swarm: [
                            '/ip4/0.0.0.0/tcp/0'
                        ],
                        /*(
                            // slave node
                            (signallingAddress && [ signallingAddress ]) ||
                            // master node
                            Object.keys(swarm._addresses).filter(function (address) {
                                return (address.indexOf('/ip4/' + ip + '/') === 0);
                            })
                        ),*/
                        // Web interface
                        API: '/ip4/127.0.0.1/tcp/5002',                        
                        // The address that the daemon will serve the gateway interface from.
                        // The gateway may be used to view files through ipfs, and serve static web content.
                        Gateway: ""
                    },
                    Discovery: {
                        MDNS: {
                            Enabled: false
                        }
                    }
                }
            };

            log("[Herd] IPFS Config:", JSON.stringify(config, null, 4));

            self.ipfs = new IPFS(config);

            process.on('SIGINT', function () {
                // @see https://github.com/ipfs-shipyard/ipfs-pubsub-room/issues/42 - Bug: handler attempts to unsubscribe to stopped node
                self.ipfs.stop().then(function () {
                    console.log('IPFS node stopped!');
                    process.exit(0);
                }).catch(function (err) {
                    console.error('IPFS node failed to stop cleanly!', err);
                    process.exit(1);
                });
            });

            self.ipfs.once('stop', function () {
                self.herd.emit("ipfsnetwork:stop");
            });

            self.ipfs.once('ready', resolve);
            
            self.herd.on("bootstrap:addresses", function (bootstrapAddresses) {

                var addresses = {};
                bootstrapAddresses.forEach(function (address) {
                    addresses[address] = true;
                });
                var remove = [];
                self.ipfs.bootstrap.list(function (err, result) {
                    if (err) throw err;

                    result.Peers.forEach(function (address) {
                        delete addresses[address];
                        if (!addresses[address]) {
                            remove.push(address);
                        }
                    });

                    Object.keys(addresses).forEach(function (address) {
                        self.ipfs.bootstrap.add(address, function (err) {
                            if (err) throw err;
                        });
                    });
                    remove.forEach(function (address) {
                        self.ipfs.bootstrap.rm(address, function (err) {
                            if (err) throw err;
                        });
                    });                
                });
            });            
        });

        self.localNetworkBootstrapAddress = await new Promise(function (resolve, reject) {

            self.ipfs.swarm.localAddrs(function (err, addresses) {
                if (err) return reject(err);

                if (!addresses.length) {
                    return reject(new Error("No local IPFS swarm addresses!"));
                }

                addresses = addresses.map(function (address) {
                    return address.toString();
                }).filter(function (address) {
                    return (
                        (address.indexOf("/" + self.herd.node.localNetworkIP + "/") !== -1) &&
                        /\/ipfs\//.test(address)
                    );
                });

                if (addresses.length !== 1) {
                    return reject(new Error("No local IPFS swarm addresse!"));
                }

                return resolve(addresses[0]);
            });
        });

        console.log("[Herd] Local Network Bootstrap Address:", self.localNetworkBootstrapAddress);

        await FS.writeFileAsync(self.herd.localNetworkBootstrapAddressPath, self.localNetworkBootstrapAddress, "utf8");

        self.ipfsPeerIdString = self.localNetworkBootstrapAddress.replace(/^.+\/ipfs\/([^\/]+)$/, "$1");


        self.localBordcastNetwork.on("nodes", function (nodes) {

            console.log("[Herd] Local Broadcast Network Nodes:", JSON.stringify(nodes, null, 4));

        });
        await self.localBordcastNetwork.init();


        // TODO: Use private key to protect messages
        var room = Room(self.ipfs, '/io.pinf.herd/heartbeat');

        room.on('subscribed', () => {

            log("[Herd] Subscribed to '/io.pinf.herd/heartbeat'");

            broadcast();
        });

        // NOTE: This event is not working
        room.on('peer joined', function (ipfsPeerId) {

            log("[Herd] Node '" + ipfsPeerId + "' joined");

            broadcast();
        });
        // NOTE: This event is not working
        room.on('peer left', function (ipfsPeerId) {

            log("[Herd] Node '" + ipfsPeerId + "' left");

            self.herd.emit("ipfsnetwork:node", {
                ipfsPeerId: ipfsPeerId,
                connected: false
            });
        });

        room.on('message', function (envelope) {
            var message = JSON.parse(envelope.data.toString());
            if (message.ipfsPeerId !== envelope.from) {
                return;
            }
            message.connected = true;
            self.herd.emit("ipfsnetwork:node", message);
        });

        function broadcast () {
            room.broadcast(JSON.stringify(self.makeHerdBroadcastPayload(), null, 4));
        }

        var interval = setInterval(broadcast, 15 * 1000);

        self.ipfs.on('stop', function () {
            if (interval) {
                clearInterval(interval);
                interval = null;
            }
        });
    }

    makeLocalNetworkBroadcastPayload () {
        return {
            herdVersion: this.herd.version,
            nodePeerId: this.herd.node.peerIdString,
            localNetworkIP: this.herd.node.localNetworkIP,
            ipfsLocalNetworkBootstrapAddress: this.localNetworkBootstrapAddress
        };
    }

    makeHerdBroadcastPayload () {
        return LODASH_MERGE(this.makeLocalNetworkBroadcastPayload(), {
            ipfsPeerId: this.localNetworkBootstrapAddress.replace(/^.+\/ipfs\/([^\/]+)$/, "$1"),
            uname: this.herd.node.uname,
            authorized_keys: ((function () {
                var path = PATH.join(process.env.HOME, ".ssh/authorized_keys");
                if (FS.existsSync(path)) {
                    return FS.readFileSync(path, "utf8").split("\n");
                }
                return [];
            })())
        });
    }
}

class LocalBroadcastNetwork extends EventEmitter {

    constructor (network) {
        super();
        let self = this;
        self.libp2p = new libp2p(defaultsDeep({
            peerInfo: network.herd.node.peerInfo
        }, {
            modules: {
                transport: [ TCP ],
                streamMuxer: [ Mplex ],
                connEncryption: [ SECIO ],
                peerDiscovery: [ MulticastDNS ]
            },
            config: {
                peerDiscovery: {
                    mdns: {
                        interval: 5000,
                        enabled: true
                    }
                }
            }
        }));
        self.network = network;
    }

    async init () {
        let self = this;

        self.network.herd.node.peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0');

        self.libp2p.start(function (err) {
            if (err) throw err;

            let message = self.network.makeLocalNetworkBroadcastPayload();
            message.connected = true;
            self.network.herd.emit("localbroadcastnetwork:node", message);

            var peers = {};

            self.libp2p.on('peer:connect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalBroadcastNetwork] Node '" + id + "' connected");
            });
            self.libp2p.on('peer:disconnect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalBroadcastNetwork] Node '" + id + "' disconnected");
                if (!peers[id]) return;
                peers[id].disconnect();
            });
            self.libp2p.on('peer:discovery', function (peer) {
                const id = peer.id.toB58String();
                //console.log("[LocalBroadcastNetwork] peer:discovery:", id);
                if (peers[id]) {
                    peers[id].lastDiscoveryTime = Date.now();
                    return;
                }

                peers[id] = {
                    connectTime: Date.now(),
                    lastDiscoveryTime: Date.now(),
                    connect: function () {

                        if (id === self.network.ipfsPeerIdString) {
                            // No need to connect to our IPFS node.
                            return;
                        }

                        console.log("[LocalBroadcastNetwork] Connect to node '" + id + "' using '/io-pinf-herd/local-broadcast-network' protocol");

                        // TODO: Dial until it works
                        self.libp2p.dialProtocol(peer, '/io-pinf-herd/local-broadcast-network', function (err, conn) {
                            if (err) {
                                console.error("[LocalBroadcastNetwork] Warning: Error dialing discovered node '" + id + "':", err.message);
                                return;
                            }

                            // Feed received messages to message handler
                            pull(conn, function (read) {
                                read(null, function next (end, data) {
                                    if (end) return;
                                    peers[id].onMessage(JSON.parse(data.toString()));
                                    read(null, next)
                                });
                            });

                            // Send signal payload once now that we are connected
                            const p = Pushable();
                            pull(p, conn);
                            peers[id].sendMessage._sender = function (message) {
                                p.push(JSON.stringify(message));
                            }

                            peers[id].onConnected();
                        });
                    },
                    onConnected: function () {

                        console.log("[LocalBroadcastNetwork] Send payload to node '" + id + "'");

                        peers[id].sendMessage(self.network.makeLocalNetworkBroadcastPayload());
                    },
                    onMessage: function (message) {

                        //console.log("[LocalBroadcastNetwork] Received message:", message);

                        message.connected = true;

                        self.network.herd.emit("localbroadcastnetwork:node", message);
                    },
                    sendMessage: function (message) {
                        peers[id].sendMessage._sender(message);
                    },
                    disconnect: function () {
                        self.network.herd.emit("localbroadcastnetwork:node", {
                            nodePeerId: id,
                            connected: false
                        });
                        peers[id] = null;
                        delete peers[id];
                    }
                };

                peers[id].connect();                    
            });

            self.libp2p.handle('/io-pinf-herd/local-broadcast-network', function (protocol, conn) {

                const p = Pushable();
                pull(p, conn);

                function sendMessage (message) {
                    p.push(JSON.stringify(message));
                }

                function onMessage (message) {

                    message.connected = true;
                    self.network.herd.emit("localbroadcastnetwork:node", message);

                    console.log("[LocalBroadcastNetwork] Send payload to node '" + message.nodePeerId + "'");

                    sendMessage(self.network.makeLocalNetworkBroadcastPayload());
                }

                // Feed received messages to message handler
                pull(conn, function (read) {
                    read(null, function next (end, data) {
                        if (end) return;
                        onMessage(JSON.parse(data.toString()));
                        read(null, next)
                    });
                });
            });
        });
    }
}

// ####################################################################################################

/*
function startSignallingServer () {

    return getLocalNetworkIP().then(function (bindIP) {

        log("Bind signalling server to local IP:", bindIP);

        return new Promise(function (resolve, reject) {
            RENDEZVOUS.start({
                host: bindIP
            }, (err, server) => {
                if (err) return reject(err);

                var address = "/ip4/" + bindIP + "/tcp/" + server.info.port + "/ws/p2p-websocket-star";

                log("Signalling server address:", address);
                
                FS.outputFileSync(PATH.join(HOME_DIR, ".signalling.address"), address, "utf8");
                FS.outputFileSync(PATH.join(HOME_DIR, ".signalling.uri"), server.info.uri, "utf8");

                startMulticastNode(address).then(function () {
                    return resolve(address);
                }, reject);
            });
        });
    });
}
*/
/*
function set2 () {
    
    const OrbitDB = require('orbit-db')

    if (process.argv[2] == "1") {

            const orbitdb = new OrbitDB(ipfs, "./testreplicate")

            // The same orbitdb address from the beginning of the post
            var testDBAddr = "/orbitdb/Qmd7onRynKUWNP13uUu3r5XAio1omL1p1gcohQ2pmH9Z48/QmVpwjDqejU7Wu3SGPVJc3JPQBtzqnNHYj5nKp1J1wmDzb" // Your orbitdb
            const replicateddb = await orbitdb.log(testDBAddr)
            replicateddb.events.on("replicated", (address) => {
                console.log(replicateddb.iterator({ limit: -1 }).collect())
            })

    } else {

        // Client
            var orbitdb = new OrbitDB(ipfs)

            var globaldb = await orbitdb.log(ipfsId.publicKey);
            await globaldb.load();

            var db1Addr = globaldb.address.toString()

        console.log("db1Addr", db1Addr);

    }
}
*/
/*
#if [ -e "cat /etc/*release" ]; then
    #eval "$(cat /etc/*release | sed -e 's/^/_OS_/')"

    #if [ "${_OS_ID}" == "ubuntu" ] && [[ "${_OS_VERSION_ID}" == "16."* ]]; then
        echo -e "\n[herd.sh]   NOTE: To start io.pinf.herd on OS boot run 'sudo ~/.io.pinf/herd/node_modules/.bin/pm2 startup' on the remote system.\n"
    #fi
#fi
*/
