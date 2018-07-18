
'use strict'

const PATH = require("path");
const FS = require("fs-extra");
const MINIMIST = require("minimist");
const LODASH = require("lodash");
const INTERNAL_IP = require('internal-ip');
// https://github.com/libp2p/js-libp2p-websocket-star-rendezvous
const RENDEZVOUS = require('libp2p-websocket-star-rendezvous');
const CHILD_PROCESS = require("child_process");
const SPAWN = CHILD_PROCESS.spawn;
const Promise = require("bluebird");
const PM2 = require('pm2');
const SOCKET_IO_CLIENT = require('socket.io-client');
const IPFS = require('ipfs');
const PEM = require('pem');

// https://github.com/ipfs-shipyard/ipfs-pubsub-room
const Room = require('ipfs-pubsub-room');
const PeerId = require('peer-id');
// https://github.com/libp2p/js-peer-info
const PeerInfo = require('peer-info');
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
const toStream = require('pull-stream-to-stream')


const HOME_DIR = PATH.join(process.env.HOME, ".io.pinf", "herd");


const UNAME = CHILD_PROCESS.execSync("uname -a").toString();


var ipfsPeerIdPath = PATH.join(HOME_DIR, ".ipfs.peer.id");


function set2 () {
    
    const OrbitDB = require('orbit-db')

    if (process.argv[2] == "1") {

    /*
            const orbitdb = new OrbitDB(ipfs, "./testreplicate")

            // The same orbitdb address from the beginning of the post
            var testDBAddr = "/orbitdb/Qmd7onRynKUWNP13uUu3r5XAio1omL1p1gcohQ2pmH9Z48/QmVpwjDqejU7Wu3SGPVJc3JPQBtzqnNHYj5nKp1J1wmDzb" // Your orbitdb
            const replicateddb = await orbitdb.log(testDBAddr)
            replicateddb.events.on("replicated", (address) => {
                console.log(replicateddb.iterator({ limit: -1 }).collect())
            })
    */


    } else {

        // Client

    /*
            var orbitdb = new OrbitDB(ipfs)

            var globaldb = await orbitdb.log(ipfsId.publicKey);
            await globaldb.load();

            var db1Addr = globaldb.address.toString()

    console.log("db1Addr", db1Addr);
    */


    }
}




class Node {

    constructor () {


    }

    async function getLocalNetworkIP () {
        if (!getLocalNetworkIP._ip) {
            getLocalNetworkIP._ip = INTERNAL_IP.v4();
        }
        return getLocalNetworkIP._ip;    
    }
}


class Herd {



    constructor () {

    }
}



class MulticastNetwork {

    constructor () {

    }

}


class HerdNetwork {

}






function getLocalNetworkIP () {
    if (!getLocalNetworkIP._ip) {
        getLocalNetworkIP._ip = INTERNAL_IP.v4();
    }
    return getLocalNetworkIP._ip;
}

// TODO: Rename to 'getMulticastPeerInfo()'
function getPeerInfo () {

    if (!getPeerInfo._peer) {
        getPeerInfo._peer = new Promise(function (resolve, reject) {

            // TODO: Rename to '.multicast.peer.id'
            var peerIdPath = PATH.join(HOME_DIR, ".peer.id");

            function init (id) {
                PeerInfo.create(id, function (err, peerInfo) {
                    if (err) return reject(err);

                    log("Our peer id:", peerInfo.id.toB58String());

                    return resolve(peerInfo);
                });    
            }

            FS.exists(peerIdPath, function (exists) {
                if (exists) {
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
        });
    }
    return getPeerInfo._peer;
}

function log () {
    var args = Array.from(arguments);
    getLocalNetworkIP().then(function (ip) {
        args.unshift("[herd][" + ip + "]");
        console.log.apply(console, args);
    });
}

class MulticastNetwork extends libp2p {
    constructor (_options) {
        const defaults = {
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
        }

        super(defaultsDeep(_options, defaults))
    }
}


var swarmAddressesPath = PATH.join(HOME_DIR, ".multicast.addresses");
var heartbeatStatePath = PATH.join(HOME_DIR, ".heartbeat.state");

var swarm = {
    _addresses: {},
    add: function (peerId, signallingAddress) {
        if (swarm._addresses[signallingAddress] === peerId) return;

        Object.keys(swarm._addresses).forEach(function (address) {
            if (
                swarm._addresses[address] === peerId &&
                address !== signallingAddress
            ) {
                log("Signalling address changed from '" + address + "' to '" + signallingAddress + "' for peer id:", peerId);
                delete swarm._addresses[address];
            }
        });

        swarm._addresses[signallingAddress] = peerId;

        FS.writeFile(swarmAddressesPath, JSON.stringify(swarm._addresses, null, 4), "utf8", function (err) {
            if (err) throw err;

            console.log("Updated IPFS Swarm:", JSON.stringify(swarm._addresses, null, 4));

        });
    },
    load: function () {
        if (FS.existsSync(swarmAddressesPath)) {
            swarm._addresses = JSON.parse(FS.readFileSync(swarmAddressesPath, "utf8"));
            log("Loaded cached swarm addresses:", JSON.stringify(swarm._addresses, null, 4));
        }
    }
};


function startMulticastNode (signallingAddress) {

    return getLocalNetworkIP().then(function (ip) {

        return getPeerInfo().then(function (peerInfo) {

            swarm.add(peerInfo.id.toB58String(), signallingAddress);

            peerInfo.multiaddrs.add('/ip4/0.0.0.0/tcp/0')

            var node = new MulticastNetwork({
                peerInfo
            })
            node.start(function (err) {

                var peers = {};

                node.on('peer:connect', function (peer) {
                    const id = peer.id.toB58String();
                    console.log("[MulticastNetwork] peer:connect:", id);
                });
                node.on('peer:disconnect', function (peer) {
                    const id = peer.id.toB58String();
                    console.log("[MulticastNetwork] peer:disconnect:", id);
                    if (!peers[id]) return;
                    peers[id].disconnect();
                });
                node.on('peer:discovery', function (peer) {
                    const id = peer.id.toB58String();
                    //console.log("[MulticastNetwork] peer:discovery:", id);
                    if (peers[id]) {
                        peers[id].lastDiscoveryTime = Date.now();
                        return;
                    }

                    peers[id] = {
                        connectTime: Date.now(),
                        lastDiscoveryTime: Date.now(),
                        connect: function () {

                            console.log("[MulticastNetwork] Connect to node using 'io-pinf-herd' protocol:", id);

                            // TODO: Dial until it works
                            node.dialProtocol(peer, '/io-pinf-herd', function (err, conn) {
                                if (err) {
                                    console.error("[MulticastNetwork] Warning: Error dialing discovered node:", err.message);
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

                            console.log("[MulticastNetwork] Connected peer:", id);

                            peers[id].sendMessage({
                                peerId: peerInfo.id.toB58String(),
                                signallingAddress: signallingAddress
                            });
                        },
                        onMessage: function (message) {

                            console.log("[MulticastNetwork] Received message:", message);

                            if (message.signallingAddress) {
                                swarm.add(id, message.signallingAddress);
                            }
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

                node.handle('/io-pinf-herd', function (protocol, conn) {

                    const p = Pushable();
                    pull(p, conn);

                    function sendMessage (message) {
                        p.push(JSON.stringify(message));
                    }

                    function onMessage (message) {

                        console.log("[MulticastNetwork] Received client message:", message);

                        if (
                            message.peerId &&
                            message.signallingAddress
                        ) {
                            swarm.add(message.peerId, message.signallingAddress);
                        }

                        sendMessage({
                            signallingAddress: signallingAddress
                        });
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
        });
    });
}

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


var ipfsBootstrapAddressesPath = PATH.join(HOME_DIR, ".ipfs.bootstrap.addresses");


function startIPFS (peerId, signallingAddress) {

    return getLocalNetworkIP().then(function (ip) {

        return new Promise(function (resolve, reject) {

            var config = {
                repo: PATH.join(HOME_DIR, "ipfs"),
                EXPERIMENTAL: {
                    pubsub: true
                },
                config: {
                    // List of ipfs peers that your daemon will connect to on startup.
                    // TODO: Get bootstrap address correct for slave nodes to connect to the master node that added them.
                    "Bootstrap": (signallingAddress && [ signallingAddress + "/ipfs/" + peerId ]) || [],
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
                        // The address that the daemon will serve the gateway interface from.
                        // The gateway may be used to view files through ipfs, and serve static web content.
                        Gateway: ""
                    }
                }
            };

            log("IPFS config:", JSON.stringify(config, null, 4));

            var ipfs = new IPFS(config);

            process.on('SIGINT', function () {
                // @see https://github.com/ipfs-shipyard/ipfs-pubsub-room/issues/42 - Bug: handler attempts to unsubscribe to stopped node
                ipfs.stop()
                    .then(() => console.log('IPFS node stopped!'))
                    .catch(error => console.error('IPFS node failed to stop cleanly!', error));
            });

            ipfs.once('ready', () => ipfs.id((err, info) => {
                if (err) return reject(err);

                console.log('IPFS node ready with address:', info.id)

                FS.writeFileSync(ipfsPeerIdPath, info.id, "utf8");

                ipfs.swarm.addrs(function (err, nodes) {
                    if (err) return reject(err);

                    nodes = nodes.map(function (node) {
                        return {
                            peerId: node.id.toB58String(),
                            addresses: node.multiaddrs.toArray().map(function (address) {
                                return address.toString();
                            })
                        }
                    });

                    if (nodes.length) {

                        if (nodes.length > 1) {
                            console.error("nodes", nodes);
                            throw new Error("More than one swarm node found!");
                        }

                        console.log("IPFS swarm nodes:", nodes);

                        var networkAddress = nodes[0].addresses.filter(function (address) {
                            return (address.indexOf("/" + ip + "/") !== -1);
                        })[0];

                        FS.writeFileSync(ipfsBootstrapAddressesPath, networkAddress, "utf8");
                    }
                });

                resolve(ipfs);
            }));
        });
    });
}

function addClientNode (clientUri, signallingAddress) {

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

        return getPeerInfo().then(function (peerInfo) {

            return new Promise(function (resolve, reject) {

                log("Running shell script at '" + clientUri + "' using ssh");

                var proc = SPAWN("ssh", [
                    "-A",
                    clientUri,
                    'bash ~/.io.pinf.herd.sh remotestart ' + FS.readFileSync(ipfsPeerIdPath, "utf8") + ' ' + FS.readFileSync(ipfsBootstrapAddressesPath, "utf8")
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
    });
}

function ensureMasterNode (verify) {

    function start () {
        if (verify) {
            throw new Error("Master node not running after trying to start it!");
        }

        log("Signalling server is NOT running. Starting master node ...");

        return exports.startMasterNodeProcess().then(function () {
            return Promise.delay(5000).then(function () {
                return ensureMasterNode(true);
            });
        });
    }

    if (!FS.existsSync(PATH.join(HOME_DIR, ".signalling.address"))) {
        return Promise.try(function () {
            return start();
        });
    }

    return new Promise(function (resolve, reject) {

        log("Connecting to signalling server to see if master process is running ...");

        var signallingUri = FS.readFileSync(PATH.join(HOME_DIR, ".signalling.uri"), "utf8");

        log("signallingUri:", signallingUri);

        var connection = SOCKET_IO_CLIENT.connect(signallingUri, {
            reconnection: false,
            timeout: 5000,
            connect_timeout: 5000,
            transports: [ 'websocket' ],
            'force new connection': true
        });
        connection.on('connect_error', function (err) {
            reject(new Error("Connect error"));
        });
        connection.on('connect_timeout', function () {
            reject(new Error("Connect timeout"));
        });
        connection.on('connect', function () {
            connection.close();
        });
        connection.on('disconnect', function () {
            resolve(null);
        });

    }).catch(function (err) {

        return start();
    }).then(function () {

        log("Signalling server is running");

        return FS.readFileSync(PATH.join(HOME_DIR, ".signalling.address"), "utf8");
    });
}

exports.startMasterNodeProcess = function () {

    return new Promise(function (resolve, reject) {

        log("Start master node process using pm2");
        
        var callback = function (err) {
            PM2.disconnect();

            if (err) {
                console.error(err);
                process.exit(1);
            }

            resolve(null);
        }

        PM2.connect(function (err) {
            if (err) return callback(err);

            PM2.start({
                script: 'herd.js',
                name: 'io.pinf.herd'
            }, function (err, apps) {
                if (err) return callback(err);

                log("Started master node process using pm2");

                return callback(null);
            });
        });
    });
}

function onIPFSReady (ipfs) {

    return getLocalNetworkIP().then(function (ip) {

        return getPeerInfo().then(function (peerInfo) {

            log("onIPFSReady()");

            // TODO: Use private key to protect messages
            var room = Room(ipfs, 'io.pinf.herd/heartbeat');

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

                FS.writeFile(heartbeatStatePath, JSON.stringify(state, null, 4), "utf8", function (err) {
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
                    peerId: peerInfo.id.toB58String(),
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

            ipfs.on('stop', function () {
                if (interval) {
                    clearInterval(interval);
                    interval = null;
                }
            });

            return null;
        });
    });
}


function startMasterNode () {

    swarm.load();

    return startSignallingServer().then(function (signallingAddress) {
        return startIPFS().then(onIPFSReady).then(function () {
            return signallingAddress;
        });
    });
}

exports.startPeerNodeProcess = function (peerId, signallingAddress) {

    log("startPeerNodeProcess(): peerId:", peerId);
    log("startPeerNodeProcess(): signallingAddress:", signallingAddress);

    log("Start peer node process using pm2");
    
    var callback = function (err) {
        PM2.disconnect();

        if (err) {
            console.error(err);
            process.exit(1);
        }
    }

    PM2.connect(function (err) {
        if (err) return callback(err);

        PM2.start({
            script: 'herd.js',
            name: 'io.pinf.herd',
            args: 'start ' + peerId + ' ' + signallingAddress
        }, function (err, apps) {
            if (err) return callback(err);

            log("Started peer node process using pm2");

            return callback(null);
        });
    });
}

function startPeerNode (peerId, signallingAddress) {

    log("Connect via signalling server:", peerId, signallingAddress);

    return startIPFS(peerId, signallingAddress).then(onIPFSReady);
}


if (require.main === module) {

    var args = MINIMIST(process.argv.slice(2));

    async function main () {

        if (args._[0] === 'show') {

            if (FS.existsSync(heartbeatStatePath)) {
                console.log(JSON.stringify(JSON.parse(FS.readFileSync(heartbeatStatePath, "utf8")), null, 4));
            } else {
                console.log("Not running");
            }

        } else
        if (args._[0] === 'add') {

            return ensureMasterNode().then(function (signallingAddress) {

                log("Add peer node");

                return addClientNode(args._[1], signallingAddress);
            });

        } else
        if (args._[0] === 'start') {

            log("Start peer node");

            return startPeerNode(args._[1], args._[2]);

        } else {

            log("Start master node");

            return startMasterNode();
        }
    }

    main().catch(function (err) {
        console.error(err);
        process.exit(1);
    });
}
