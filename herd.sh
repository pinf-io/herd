#!/usr/bin/env bash

if [ "${1}" == "remotestart" ]; then

    ##################################################
    # Called via ssh on a remote system
    ##################################################

    peerId="${2}"
    signallingAddress="${3}"

    pushd ~/ > /dev/null

        if [ ! -e ".nvm/nvm.sh" ]; then
            echo "[herd.sh] '~/.nvm/nvm.sh' not found! Please install on remote host first: https://github.com/creationix/nvm"
        fi
        . .nvm/nvm.sh

        nvm use 8 || nvm install 8

        herdHomeDir=".io.pinf/herd"

        [ -e ".io.pinf" ] || mkdir ".io.pinf"
        [ -e "${herdHomeDir}" ] || mkdir "${herdHomeDir}"

        mv -f ".io.pinf.herd.sh" "${herdHomeDir}/herd.sh"
        mv -f ".io.pinf.herd.js" "${herdHomeDir}/herd.js"

        if [ -e "${herdHomeDir}/package.json" ]; then
            if ! cmp --silent ".io.pinf.package.json" "${herdHomeDir}/package.json"; then
                forceInstall=1
            fi
        fi
        mv -f ".io.pinf.package.json" "${herdHomeDir}/package.json"

        pushd "${herdHomeDir}" > /dev/null

            if [ ! -e "node_modules" ] || [[ $forceInstall == 1 ]]; then

                echo "[herd.sh] Installing dependencies ..."
                npm install

                #if [ -e "cat /etc/*release" ]; then

                    #eval "$(cat /etc/*release | sed -e 's/^/_OS_/')"

                    #if [ "${_OS_ID}" == "ubuntu" ] && [[ "${_OS_VERSION_ID}" == "16."* ]]; then
                        echo -e "\n[herd.sh]   NOTE: To start io.pinf.herd on OS boot run 'sudo ~/.io.pinf/herd/node_modules/.bin/pm2 startup' on the remote system.\n"
                    #fi
                #fi
            fi

            ##################################################
            # Start peer node
            ##################################################

            echo "[herd.sh] peerId: ${peerId}"
            echo "[herd.sh] signallingAddress: ${signallingAddress}"

            node --eval 'require("./herd.js").startPeerNodeProcess("'${peerId}'", "'${signallingAddress}'");'

            # NOTE: This message is matched in 'herd.js' to kill the ssh connection.
            echo "[herd.sh] PEER NODE STARTED!"

        popd > /dev/null

    popd > /dev/null

elif [ "${1}" == "add" ]; then

    ##################################################
    # Add peer node
    ##################################################

    node ./herd.js $@

elif [ "${1}" == "show" ]; then

    ##################################################
    # Show herd
    ##################################################

    node ./herd.js $@

else

    ##################################################
    # Start master node
    ##################################################

    echo -e "\n[herd.sh]   NOTE: To start io.pinf.herd on OS boot run 'sudo ~/.io.pinf/herd/node_modules/.bin/pm2 startup'.\n"

    node --eval 'require("./herd.js").startMasterNodeProcess();'

fi
