herd
====

| Herd a bunch of nodes (ssh accessible servers) into a herd.

Uses [IPFS](https://github.com/ipfs/js-ipfs) to connect a bunch of nodes into a cohesive whole. Intended for low volume, small data, fault tolerant chatter between nodes in the herd. Ideal for providing the networked computing node foundation for a distributed software toolchain.

Features:

  * Connect nodes on a local network into a herd
  * One node per ssh accessible server
  * One node is the master
  * Show status of herd on command-line
  * TODO:
    * Connect nodes on a public network
    * Sync shared object between nodes (using orbit-db)
    * Broadcast messages to herd
    * Send messages between nodes
    * Show status of herd in browser
    * Elect new master node
    * Seamless key rotation


Install
-------

    npm install -g @io.pinf/herd


Usage
-----

Start a herd with one node:

    herd

Add a remote node to the herd:

    # Add a node from any node
    herd add user@192.168.0.10

Keep nodes running:

    # On the system for each node
    ~/.io.pinf/herd/node_modules/.bin/pm2 startup

Show herd:

    herd show

API
===

*TODO*


Details
=======

Design
------

  * The first **herd** node is the **MasterNode**. It is used to add **ChildNode**s to the **herd** by using `ssh` internally to bootstrap **herd** on other nodes. 
  * On each node, **herd** runs two protocol networks:
    * **Multicast DNS** - Using `libp2p` to coordinate zero config bootstrapping for `ipfs` nodes.
      * Each node  **IP**s and **PeerID**s are broadcast to local network to sync changes

Flow
----

  1. Open terminal on your primary unix system
    * Must have `node` version **8+** installed: `nvm install 8`
  2. Install **herd** globally using `npm install -g @io.pinf/herd`
  3. Run `herd startup` to start your **MasterNode**
    * 


Entities
--------




  * **MasterNode** - The first node in the herd or the subsequently selected master node.
    * Holds:
        * `~/.io.pinf/herd/.multicast.key` - PEM encoded private key to encrypt 
        * `~/.io.pinf/herd/.signalling.address`
        * `~/.io.pinf/herd/.signalling.uri`
        * `~/.io.pinf/herd/.multicast.peer.id`
    * Runs:

  * **MulticastNetwork** - uses `libp2p` and `libp2p-mdns` to broadcast `libp2p-websocket-star-rendezvous` address from `~/.io.pinf/herd/.multicast.peer.id` as well as 



Provenance
==========

Original source logic by Christoph Dorn under MIT License since 2018.
