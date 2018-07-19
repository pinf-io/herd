
'use strict'

console.log("|\n|\n|============================== NEW PROCESS ==============================\n|\n|");

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
const LODASH = require("lodash");
const DEEPDIFF = require("deep-object-diff");
const INTERNAL_IP = require('internal-ip');
// https://github.com/libp2p/js-libp2p-websocket-star-rendezvous
const RENDEZVOUS = require('libp2p-websocket-star-rendezvous');
const CHILD_PROCESS = require("child_process");
const SPAWN = CHILD_PROCESS.spawn;
const PM2 = require('pm2');
Promise.promisifyAll(PM2);
const SOCKET_IO_CLIENT = require('socket.io-client');
const IPFS = require('ipfs');
const NET = require("net");
const PEM = require('pem');
// https://github.com/ipfs-shipyard/ipfs-pubsub-room
const Room = require('ipfs-pubsub-room');
const PeerId = require('peer-id');
Promise.promisifyAll(PeerId);
// https://github.com/libp2p/js-peer-info
const PeerInfo = require('peer-info');
Promise.promisifyAll(PeerInfo);
// https://github.com/multiformats/multiaddr
const multiaddr = require('multiaddr');
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


const HOME_DIR = PATH.join(process.env.HOME, ".io.pinf", "herd", "herds");
const UNAME = CHILD_PROCESS.execSync("uname -a").toString();


var LOCAL_NETWORK_IP = "";
function log () {
    var args = Array.from(arguments);
    args.unshift("[herd][" + LOCAL_NETWORK_IP + "]");
    console.log.apply(console, args);
}


class Node {

    static async ForNamespace (namespace) {
        let node = new Node(namespace);
        await node.init();
        return node;
    }

    constructor (namespace) {
        let self = this;

        self.namespace = namespace;
        self.homePath = PATH.join(HOME_DIR, namespace);
        self.peerIdPath = PATH.join(self.homePath, ".peer.id");
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

        log("[Node] localNetworkIP:", self.localNetworkIP);
        log("[Node] peerId:", self.peerIdString);
    }
}

class Herd {

    constructor (node) {
        let self = this;

        self.node = node;
        self.version = require("./package.json").version;

        self.localBordcastNetwork = new LocalBroadcastNetwork(self);

        self.localNetworkBootstrapAddressPath = PATH.join(self.node.homePath, ".localbroadcastnetwork.bootstrap.address");
    
        self.heartbeatStatePath = PATH.join(self.node.homePath, ".heartbeat.state");
        self.heartbeatState = (
            FS.existsSync(self.heartbeatStatePath) &&
            JSON.parse(FS.readFileSync(self.heartbeatStatePath, "utf8") || "{}")
        ) || {};
    }

    async start (bootstrapAddress) {
        let self = this;
    
        await new Promise(function (resolve, reject) {

            var config = {
                repo: PATH.join(self.node.homePath, "ipfs"),
                EXPERIMENTAL: {
                    pubsub: true
                },
                pass: self.node.peerIdString,
                config: {
                    // List of ipfs peers that your daemon will connect to on startup.
                    // TODO: Get bootstrap address correct for slave nodes to connect to the master node that added them.
                    "Bootstrap": (bootstrapAddress && [ bootstrapAddress ]) || [],
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
                    }
                }
            };

            log("[herd] IPFS Config:", JSON.stringify(config, null, 4));

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

            self.ipfs.once('ready', resolve);
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
                        (address.indexOf("/" + self.node.localNetworkIP + "/") !== -1) &&
                        /\/ipfs\//.test(address)
                    );
                });

                if (addresses.length !== 1) {
                    return reject(new Error("No local IPFS swarm addresse!"));
                }

                return resolve(addresses[0]);
            });
        });

        console.log("[herd] Local Network Bootstrap Address:", self.localNetworkBootstrapAddress);

        await FS.writeFileAsync(self.localNetworkBootstrapAddressPath, self.localNetworkBootstrapAddress, "utf8");


        await self.localBordcastNetwork.init();


        // TODO: Use private key to protect messages
        var room = Room(self.ipfs, '/io.pinf.herd/heartbeat');

        room.on('subscribed', () => {

            log("[Herd] Subscribed to '/io.pinf.herd/heartbeat'");

            broadcast();
        });

        // NOTE: This event is not working
        room.on('peer joined', function (peer) {

            log("[Herd] Node '" + peer + "' joined");

            broadcast();
        });
        // NOTE: This event is not working
        room.on('peer left', function (peer) {

            log("[Herd] Node '" + peer + "' left");

        });

        async function onMessage (message, from) {

            if (self._updateNodesMapWithNode(self.heartbeatState, message)) {

                log("[Herd] Heartbeat state:", JSON.stringify(self.heartbeatState, null, 4));

                await FS.writeFileAsync(self.heartbeatStatePath, JSON.stringify(self.heartbeatState, null, 4), "utf8");
            }
        }

        room.on('message', function (envelope) {
            onMessage(JSON.parse(envelope.data.toString()), envelope.from);
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
            peerId: this.node.peerIdString,
            localNetworkIP: this.node.localNetworkIP,
            localNetworkBootstrapAddress: this.localNetworkBootstrapAddress,
            herdVersion: this.version
        };
    }

    makeHerdBroadcastPayload () {
        return LODASH.merge(this.makeLocalNetworkBroadcastPayload(), {
            uname: UNAME,
            authorized_keys: ((function () {
                var path = PATH.join(process.env.HOME, ".ssh/authorized_keys");
                if (FS.existsSync(path)) {
                    return FS.readFileSync(path, "utf8").split("\n");
                }
                return [];
            })())
        });
    }

    _updateNodesMapWithNode (nodes, node) {
        let self = this;
        var diff = DEEPDIFF.diff(nodes[node.peerId] || {}, node);
        if (!Object.keys(diff).length) {
            // No changes
            return false;
        }
        if (node.localNetworkIP) {
            Object.keys(nodes).forEach(function (peerId) {
                if (
                    nodes[peerId].localNetworkIP === node.localNetworkIP &&
                    peerId !== self.node.peerIdString
                ) {
                    delete nodes[peerId];
                } else
                if (!nodes[peerId].localNetworkIP) {
                    delete nodes[peerId];
                }
            });
        }
        var obj = {};
        obj[node.peerId] = node;
        LODASH.merge(nodes, obj);
        return true;
    }
}

class HerdApi {

    constructor (herd) {
        this.herd = herd;
    }

    async getLocalNetworkBootstrapAddress () {
        let self = this;
        let exists = await FS.existsAsync(self.herd.localNetworkBootstrapAddressPath);
        if (!exists) return null;
        return FS.readFileAsync(self.herd.localNetworkBootstrapAddressPath, "utf8");
    }

    async ensureMasterNode () {
        let self = this;

        let bootstrapAddress = null;

        async function connect () {

            bootstrapAddress = await self.getLocalNetworkBootstrapAddress();

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
                console.error("[HerdApi] Warning: Error when pinging herd node:", err.message);
                return false;
            });            
        }

        if (await connect()) {
            return bootstrapAddress;
        }

        log("[HerdApi] Herd node is NOT running. Starting herd ...");

        await exports.StartMasterNodeProcess();

        return new Promise(function (resolve, reject) {
            var count = 0;
            var interval = setInterval(async function () {
                count++;
                if (await connect()) {
                    clearInterval(interval);
                    log("[HerdApi] Herd node now running");
                    return resolve(bootstrapAddress);
                }
                if (count > 10) {
                    clearInterval(interval);
                    return reject(new Error("[HerdApi] Timeout: Herd node not running after trying to start it!"));
                }
            }, 1000);
        });
    }

    async addNode (clientUri, bootstrapAddress) {

        function syncScript (scriptName) {
            return new Promise(function (resolve, reject) {
    
                log("[HerdApi] Syncing script '" + scriptName + "' to '" + clientUri + "' using scp");
    
                var proc = SPAWN("scp", [
                    '-q',
                    '-o LogLevel=QUIET',
                    '-o ConnectTimeout=5',
                    PATH.join(__dirname, scriptName),
                    clientUri + ":~/.io.pinf." + scriptName
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
            syncScript("herd.sh"),
            syncScript("herd.js"),
            syncScript("package.json")
            // TODO: Sync private key to server so we can protect the IPFS nodes
        ]).then(function () {
    
            return new Promise(function (resolve, reject) {
    
                log("[HerdApi] Running shell script at '" + clientUri + "' using ssh");
    
                var proc = SPAWN("ssh", [
                    "-A",
                    clientUri,
                    'bash ~/.io.pinf.herd.sh remotestart ' + bootstrapAddress
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
                        return reject(new Error("[HerdApi] Process exited with code: " + code));
                    }
                    resolve(null);
                });
            });
        });
    }    

    async show () {
        let self = this;
        if (Object.keys(self.herd.localBordcastNetwork.nodes).length) {
            process.stdout.write(JSON.stringify({
                "localBordcastNetwork": {
                    "nodes": self.herd.localBordcastNetwork.nodes
                }
            }, null, 4) + "\n");
        } else {
            process.stdout.write("[HerdApi] Local Broadcast Network has never been started!\n");
        }
        if (Object.keys(self.herd.heartbeatState).length) {
            process.stdout.write(JSON.stringify({
                "heartbeatState": self.herd.heartbeatState
            }, null, 4) + "\n");
        } else {
            process.stdout.write("[HerdApi] IPFS has never been started!\n");
        }
    }

}

class LocalBroadcastNetwork extends libp2p {

    constructor (herd) {
        super(defaultsDeep({
            peerInfo: herd.node.peerInfo
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
        this.herd = herd;
        this.nodesFilepath = PATH.join(this.herd.node.homePath, ".localbroadcastnetwork.nodes");
        this.nodes = (
            FS.existsSync(this.nodesFilepath) &&
            JSON.parse(FS.readFileSync(this.nodesFilepath, "utf8") || "{}")
        ) || {};
    }

    async init () {
        let self = this;

        self.herd.node.peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0');

        self.start(function (err) {
            if (err) throw err;

            self.updateNode(self.herd.node.peerIdString, self.herd.makeLocalNetworkBroadcastPayload());

            var peers = {};

            self.on('peer:connect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalBroadcastNetwork] Node '" + id + "' connected");
            });
            self.on('peer:disconnect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalBroadcastNetwork] Node '" + id + "' disconnected");
                if (!peers[id]) return;
                peers[id].disconnect();
            });
            self.on('peer:discovery', function (peer) {
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
                        
                        console.log("[LocalBroadcastNetwork] Connect to node '" + id + "' using '/io-pinf-herd/local-broadcast-network' protocol:", id);

                        // TODO: Dial until it works
                        self.dialProtocol(peer, '/io-pinf-herd/local-broadcast-network', function (err, conn) {
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

                        peers[id].sendMessage(self.herd.makeLocalNetworkBroadcastPayload());
                    },
                    onMessage: function (message) {

                        //console.log("[LocalBroadcastNetwork] Received message:", message);

                        self.updateNode(id, message);
                    },
                    sendMessage: function (message) {
                        peers[id].sendMessage._sender(message);
                    },
                    disconnect: function () {
                        peers[id] = null;
                        delete peers[id];
                    }
                };

                peers[id].connect();                    
            });

            self.handle('/io-pinf-herd/local-broadcast-network', function (protocol, conn) {

                const p = Pushable();
                pull(p, conn);

                function sendMessage (message) {
                    p.push(JSON.stringify(message));
                }

                function onMessage (message) {

                    if (message.peerId) {
                        self.updateNode(message.peerId, message);
                    }

                    console.log("[LocalBroadcastNetwork] Send payload to node '" + message.peerId + "'");

                    sendMessage(self.herd.makeLocalNetworkBroadcastPayload());
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

    async updateNode (peerId, node) {
        let self = this;

        if (self.herd._updateNodesMapWithNode(self.nodes, node)) {

            await FS.writeFileAsync(self.nodesFilepath, JSON.stringify(self.nodes, null, 4), "utf8");

            console.log("[LocalBroadcastNetwork] Nodes:", JSON.stringify(self.nodes, null, 4));
        }
    }

    getBootstrapAddresses () {
        let self = this;
        return Object.keys(self.nodes).map(function (node) {
            return node.address;
        });
    }

}

// ####################################################################################################
// # Entry Points
// ####################################################################################################

exports.StartMasterNodeProcess = async function () {
    log("StartMasterNodeProcess()");
    try {
        await PM2.connectAsync();
        await PM2.startAsync({
            script: 'herd.js',
            name: 'io.pinf.herd'
        });
        PM2.disconnect();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

exports.StartPeerNodeProcess = async function (bootstrapAddress) {
    log("StartPeerNodeProcess(bootstrapAddress)", bootstrapAddress);
    try {
        await PM2.connectAsync();
        await PM2.startAsync({
            script: 'herd.js',
            name: 'io.pinf.herd',
            args: 'start ' + bootstrapAddress
        });
        PM2.disconnect();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

class CLI {

    static async RunForArgs (args) {

        let node = await Node.ForNamespace("default");
        let herd = new Herd(node);
        let herdApi = new HerdApi(herd);

        switch (args._[0]) {

            case 'show':
                await herdApi.show();
                break;

            case 'add':
                await herdApi.addNode(args._[1], await herdApi.ensureMasterNode());
                break;

            case 'start':
                await herd.start(args._[1]);
                break;

            default:
                await herd.start();
                break;
        }
    }
}

if (require.main === module) {
    try {
        CLI.RunForArgs(MINIMIST(process.argv.slice(2)));
    } catch (err) {
        console.error("[herd]", err);
        process.exit(1);
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
