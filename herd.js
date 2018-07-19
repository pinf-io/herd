
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


const HOME_DIR = PATH.join(process.env.HOME, ".io.pinf", "herd");
const UNAME = CHILD_PROCESS.execSync("uname -a").toString();


function log () {
    var args = Array.from(arguments);
    Node.getLocalNetworkIP().then(function (ip) {
        args.unshift("[herd][" + ip + "]");
        console.log.apply(console, args);
    });
}


class Node {

    static async FromFile (peerIdPath) {
        let self = this;

        return new Promise(function (resolve, reject) {

            function init (id) {
                PeerInfo.create(id, function (err, peerInfo) {
                    if (err) return reject(err);

                    log("Our peer id:", peerInfo.id.toB58String());

                    return resolve(peerInfo);
                });    
            }

            FS.exists(peerIdPath, function (exists) {
                if (false && exists) {
                    FS.readFile(peerIdPath, "utf8", function (err, info) {
                        if (err) return reject(err);
                        PeerId.createFromJSON(JSON.parse(info), function (err, id) {
                            if (err) return reject(err);
                            return init(id);
                        });
                    });
                    return;
                }
                PeerId.create({
                    bits: 1024
                }, function (err, id) {
                    if (err) return reject(err);
                    log("Writing peer id to:", peerIdPath);
                    FS.writeFile(peerIdPath, JSON.stringify(id.toJSON(), null, 4), "utf8", function (err) {
                        if (err) return reject(err);
                        init(id);
                    });
                })
            });
        }).then(async function (peerInfo) {

            let node = new Node();
            node.peerInfo = peerInfo;

            log("Our peer id:", node.peerId);

            node.herdVersion = require("./package.json").version;
            node.address = "address";//await herdNetwork.getLocalNetworkAddress();

            return node;
        });
    }

    get peerId () {
        return this.peerInfo.id.toB58String();
    }

    get localNetworkIP () {
        if (!Node._Node_ip) {
            throw new Error("'Node._Node_ip' not yet available!");
        }
        return Node._Node_ip;
    }

    static async getLocalNetworkIP () {
        if (!Node._Node_ip_promise) {
            Node._Node_ip_promise = INTERNAL_IP.v4().then(function (ip) {
                Node._Node_ip = ip;
                return ip;
            });
        }
        return Node._Node_ip_promise;    
    }
}

class Herd {

    static async ForOurNode () {
        let herd = new Herd();
        herd.peerInfo = await Node.FromFile(herd.peerIdPath);
        return herd;
    }

    get version () {
        return require("./package.json").version;
    }

    get peerIdPath () {
        return PATH.join(HOME_DIR, ".peer.id");
    }

    get peerId () {
        return this.peerInfo.peerId;
    }

    static get heartbeatStatePath () {
        return PATH.join(HOME_DIR, ".heartbeat.state");
    }

    async start (bootstrapAddress) {
        let self = this;
    
        return new Promise(function (resolve, reject) {

            var config = {
                repo: PATH.join(HOME_DIR, "ipfs"),
                EXPERIMENTAL: {
                    pubsub: true
                },
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

            log("IPFS config:", JSON.stringify(config, null, 4));

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

        }).then(function () {

            return self.getLocalNetworkAddress().then(function (address) {                

                self.localNetworkAddress = address;

                console.log("Bootstrap address:", self.localNetworkAddress);

                return FS.writeFileAsync(self.localNetworkAddressPath, address, "utf8");
            });
        }).then(async function () {

            self.localNetwork = new LocalNetwork(self);

            return self.ipfs;

        }).then(function () {


            return Node.getLocalNetworkIP().then(function (ip) {

log("onIPFSReady() !!!!");

                // TODO: Use private key to protect messages
                var room = Room(self.ipfs, 'io.pinf.herd/heartbeat');

                room.on('subscribed', () => {
                    log('subscribed to room');

                    broadcast();
                });

                // NOTE: This event is not working
                room.on('peer joined', function (peer) {
                    log('peer ' + peer + ' joined');

                    broadcast();
                });
                // NOTE: This event is not working
                room.on('peer left', function (peer) {
                    log('peer ' + peer + ' left');
                });

                var state = {};

                function onMessage (message, from) {

                    var obj = {};
                    obj[message.peerId] = message;
                    LODASH.merge(state, obj);

                    FS.writeFile(Herd.heartbeatStatePath, JSON.stringify(state, null, 4), "utf8", function (err) {
                        if (err) throw err;
            
                        log("Heartbeat state:", JSON.stringify(state, null, 4));
                    });        
                }

                room.on('message', function (envelope) {
                    onMessage(JSON.parse(envelope.data.toString()), envelope.from);
                });

                function broadcast () {
                    log('broadcast identity to peers');

                    room.broadcast(JSON.stringify({
                        ip: ip,
                        peerId: self.peerInfo.peerId,
                        uname: UNAME,
                        authorized_keys: ((function () {
                            var path = PATH.join(process.env.HOME, ".ssh/authorized_keys");
                            if (FS.existsSync(path)) {
                                return FS.readFileSync(path, "utf8").split("\n");
                            }
                            return [];
                        })())
                    }, null, 4));

                    //room.sendTo(peer, 'Hello ' + peer + '!');
                }

                var interval = setInterval(broadcast, 15 * 1000);

                self.ipfs.on('stop', function () {
                    if (interval) {
                        clearInterval(interval);
                        interval = null;
                    }
                });

                return null;
            });
        });
    }

    get localNetworkAddressPath () {
        return PATH.join(HOME_DIR, ".localnetwork.address");;
    }    

    async getLocalNetworkAddress () {
        let self = this;

        let localNetworkIP = await Node.getLocalNetworkIP();

        return new Promise(function (resolve, reject) {

            self.ipfs.swarm.localAddrs(function (err, addresses) {
                if (err) return reject(err);

                if (!addresses.length) {
                    return reject(new Error("No local IPFS swarm addresses!"));
                }

                addresses = addresses.map(function (address) {
                    return address.toString();
                }).filter(function (address) {
                    return (
                        (address.indexOf("/" + localNetworkIP + "/") !== -1) &&
                        /\/ipfs\//.test(address)
                    );
                });

                if (addresses.length !== 1) {
                    return reject(new Error("No local IPFS swarm addresse!"));
                }

                return resolve(addresses[0]);
            });
        });
    }

    makeLocalNetworkPayload () {
        return {
            peerId: this.peerInfo.peerId,
            localNetworkIP: this.peerInfo.localNetworkIP,
            address: this.localNetworkAddress,
            herdVersion: this.version
        };
    }
}

class HerdApi {

    constructor (herd) {
        this.herd = herd;
    }

    async getLocalNetworkAddress () {
        let self = this;
        let exists = await FS.existsAsync(self.herd.localNetworkAddressPath);
        if (!exists) return null;
        return FS.readFileAsync(self.herd.localNetworkAddressPath, "utf8");
    }

    async ensureMasterNode (verify) {
        let self = this;

        log("[HerdApi] ensureMasterNode(verify)", verify);

        let bootstrapAddress = await self.getLocalNetworkAddress();

        function start () {
            if (verify) {
                throw new Error("Master node not running after trying to start it!");
            }
    
            log("Signalling server is NOT running. Starting master node ...");
    
            return exports.StartMasterNodeProcess().then(function () {
                return Promise.delay(5000).then(function () {
                    return self.ensureMasterNode(true);
                });
            });
        }

        log("[HerdApi] ensureMasterNode() bootstrapAddress", bootstrapAddress);

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
        }).catch(function (err) {
            console.error("Warning: Error when pinging master node:", err.message);
            return start();
        }).then(function () {
            return bootstrapAddress;
        });
    }

    async addClientNode (clientUri, bootstrapAddress) {

        function syncScript (scriptName) {
            return new Promise(function (resolve, reject) {
    
                log("Syncing script '" + scriptName + "' to '" + clientUri + "' using scp");
    
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
    
                log("Running shell script at '" + clientUri + "' using ssh");
    
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
                    if (/\[herd\.sh\] PEER NODE STARTED!/.test(chunk.toString())) {
                        proc.kill('SIGKILL');
                    }
                });
                proc.on('error', reject);
                proc.on('close', function (code) {
                    if (
                        code !== null &&
                        code !== 0
                    ) {
                        return reject(new Error("Process exited with code: " + code));
                    }
                    resolve(null);
                });
            });
        });
    }    

    async show () {
        if (FS.existsSync(Herd.heartbeatStatePath)) {
            process.stdout.write(JSON.stringify(JSON.parse(FS.readFileSync(Herd.heartbeatStatePath, "utf8")), null, 4) + "\n");
        } else {
            process.stdout.write("Not running\n");
        }
    }

}

class LocalNetwork extends libp2p {

    constructor (herd) {

        super(defaultsDeep({
            peerInfo: herd.peerInfo.peerInfo
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

        let self = this;

        self.nodesFilepath = PATH.join(HOME_DIR, ".localnetwork.nodes");
        self.nodes = (
            FS.existsSync(self.nodesFilepath) &&
            JSON.parse(FS.readFileSync(self.nodesFilepath, "utf8") || "{}")
        ) || {};
        log("[LocalNetwork] Loaded cached swarm addresses:", JSON.stringify(self.nodes, null, 4));

        herd.peerInfo.peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0');

        self.updateNode(herd.peerId, herd.makeLocalNetworkPayload());

        self.start(function (err) {
            if (err) throw err;

            var peers = {};

            self.on('peer:connect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalNetwork] peer:connect:", id);
            });
            self.on('peer:disconnect', function (peer) {
                const id = peer.id.toB58String();
                console.log("[LocalNetwork] peer:disconnect:", id);
                if (!peers[id]) return;
                peers[id].disconnect();
            });
            self.on('peer:discovery', function (peer) {
                const id = peer.id.toB58String();
                //console.log("[LocalNetwork] peer:discovery:", id);
                if (peers[id]) {
                    peers[id].lastDiscoveryTime = Date.now();
                    return;
                }

                peers[id] = {
                    connectTime: Date.now(),
                    lastDiscoveryTime: Date.now(),
                    connect: function () {
                        
                        console.log("[LocalNetwork] Connect to node using 'io-pinf-herd-local-network' protocol:", id);

                        // TODO: Dial until it works
                        self.dialProtocol(peer, '/io-pinf-herd/local-network', function (err, conn) {
                            if (err) {
                                console.error("[LocalNetwork] Warning: Error dialing discovered node:", err.message);
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

                        console.log("[LocalNetwork] Connected peer:", id);

                        peers[id].sendMessage(herd.makeLocalNetworkPayload());
                    },
                    onMessage: function (message) {

                        console.log("[LocalNetwork] Received message:", message);

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

            self.handle('/io-pinf-herd/local-network', function (protocol, conn) {

                const p = Pushable();
                pull(p, conn);

                function sendMessage (message) {
                    p.push(JSON.stringify(message));
                }

                function onMessage (message) {

                    console.log("[LocalNetwork] Received client message:", message);

                    if (message.peerId) {
                        self.updateNode(message.peerId, message);
                    }

                    sendMessage(herd.makeLocalNetworkPayload());
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

    updateNode (peerId, properties) {
        let self = this;

        console.log("[LocalNetwork] Update node:", peerId, properties);

        if (properties.localNetworkIP) {
            Object.keys(self.nodes).forEach(function (id) {
                if (
                    (
                        self.nodes[id].localNetworkIP === properties.localNetworkIP &&
                        id !== peerId
                    ) || (
                        id === peerId &&
                        self.nodes[id].localNetworkIP !== properties.localNetworkIP
                    )
                ) {
                    log("[LocalNetwork] Node IP changed from '" + self.nodes[id].localNetworkIP + "' to '" + properties.localNetworkIP + "' for peer id:", peerId);
                    delete self.nodes[id];
                } else
                if (!self.nodes[id].localNetworkIP) {
                    delete self.nodes[id];
                }
            });
        }

        self.nodes[peerId] = self.nodes[peerId] || {};

        Object.keys(properties).forEach(function (name) {
            self.nodes[peerId][name] = properties[name];
        });

        FS.writeFile(self.nodesFilepath, JSON.stringify(self.nodes, null, 4), "utf8", function (err) {
            if (err) throw err;

            console.log("[LocalNetwork] Updated nodes:", JSON.stringify(self.nodes, null, 4));

        });
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

        let herd = await Herd.ForOurNode();
        let herdApi = new HerdApi(herd);

        let command = args._[0];

        switch (command) {

            case 'show':
                await herdApi.show();
                break;

            case 'add':
                await herdApi.addClientNode(args._[1], await herdApi.ensureMasterNode());
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
