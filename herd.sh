#!/usr/bin/env bash

set -e

function sourceNode {

    echo "[herd.sh] uname: $(uname -a)"

    if [ ! -e "${HOME}/.nvm/nvm.sh" ]; then
        echo "[herd.sh] 'node' and '~/.nvm/nvm.sh' not found! Please install on remote host first: https://github.com/creationix/nvm"
        exit 1
    fi

    echo "[herd.sh] sourcing '${HOME}/.nvm/nvm.sh' to install NodeJS 10"
    echo "[herd.sh] NOTE: If this fails, login to the server yourself to install NodeJS 10 using 'nvm install 10'"

    . "${HOME}/.nvm/nvm.sh"
    nvm install 10

    echo "[herd.sh] node: '$(node --version)'"
}

if ! which node > /dev/null ; then
    sourceNode
else
    version=$(node --version 2>&1 | perl -pe 's/^v(\d+).+$/$1/')
    if (("${version}" < "10")); then
        sourceNode
    fi
fi

nodeCommand="$(nvm which 10)"
npmCommand="$(nvm which 10 | perl -pe 's/^(.+\/)[^\/]+$/$1npm/')"

eval $(${nodeCommand} --eval '
    const args = process.argv.slice(1);
    var namespace = "default";
    var namespaceIndex = args.indexOf("--namespace");
    if (namespaceIndex >= 0) {
        namespace = args.splice(namespaceIndex, 2).pop();
    }
    process.stdout.write("namespace=\"" + namespace + "\"\n");
    process.stdout.write("arg1=\"" + (args[0] || "") + "\"\n");
    process.stdout.write("arg2=\"" + (args[1] || "") + "\"\n");
' -- $@)

herdHomeDir="${HOME}/.io.pinf/herd/herds/${namespace}"
[ -e "${herdHomeDir}" ] || mkdir -p "${herdHomeDir}"

function deriveOurDir {
	function BO_deriveSelfDir {
		# @source http://stackoverflow.com/a/246128/330439
		local SOURCE="$2"
		local DIR=""
		while [ -h "$SOURCE" ]; do
            DIR="$( cd -P "$( dirname "$SOURCE" )" && pwd )"
            SOURCE="$(readlink "$SOURCE")"
            [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
		done
		echo "$( cd -P "$( dirname "$SOURCE" )" && pwd )"
	}
	BO_deriveSelfDir "$""{BASH_SOURCE[0]:-$""0}"
}
ourDir="$(deriveOurDir)"

function syncFilesToHome {
    echo "[herd.sh] Sync files from '${1}' to '${herdHomeDir}'"

    cmd="cp"
    if [[ "${1}" == *"/.~io.pinf~" ]]; then
        cmd="mv"
    fi

    $cmd -f "${1}herd.sh" "${herdHomeDir}/herd.sh"
    $cmd -f "${1}herd.js" "${herdHomeDir}/herd.js"

    if [ -e "${herdHomeDir}/package.json" ]; then
        if ! cmp --silent "${1}package.json" "${herdHomeDir}/package.json"; then
            forceInstall=1
        fi
    fi
    $cmd -f "${1}package.json" "${herdHomeDir}/package.json"
    $cmd -f "${1}npm-shrinkwrap.json" "${herdHomeDir}/npm-shrinkwrap.json"

    if [ -e "${1}.shared.private.key" ]; then
        if [ -e "${herdHomeDir}/.shared.private.key" ]; then
            if ! cmp --silent "${1}.shared.private.key" "${herdHomeDir}/.shared.private.key"; then
                echo "[herd.sh] ERROR: Different private key already exists at '${herdHomeDir}/.shared.private.key'. Remove first!"
                rm -f "${1}.shared.private.key"
                exit 1
            fi
        fi
        $cmd -f "${1}.shared.private.key" "${herdHomeDir}/.shared.private.key"
    fi

    if [ ! -e "${herdHomeDir}/node_modules/.installed" ] || [[ $forceInstall == 1 ]]; then
        version=$(${npmCommand} --version 2>&1 | perl -pe 's/^v(\d+).+$/$1/')
        echo "[herd.sh] Installing dependencies using npm (${version}) ..."
        if (("${version:0:1}" < "6")); then
            echo "[herd.sh] ERROR: 'npm' version must be at least '6'!"
            exit 1
        fi
        pushd "${herdHomeDir}" > /dev/null
            ${npmCommand} ci
            touch "node_modules/.installed"
        popd > /dev/null
    fi
}

if [ -e "${ourDir}/.~io.pinf~herd.sh" ]; then
    syncFilesToHome "${ourDir}/.~io.pinf~"
elif [ -e "${ourDir}/herd.sh" ]; then

    pushd "${ourDir}" > /dev/null
        ${npmCommand} shrinkwrap
    popd > /dev/null

    if [ "${ourDir}" != "${herdHomeDir}" ]; then
        syncFilesToHome "${ourDir}/"
    fi
fi

if [ "${arg1}" == "remotestart" ]; then

    ##################################################
    # Called via ssh on a remote system
    ##################################################

    ${nodeCommand} "${herdHomeDir}/herd.js" --ns "${namespace}" --daemonize bootstrap "${arg2}"

    # NOTE: This message is matched in 'herd.js' to kill the ssh connection.
    echo "[herd.sh] HERD NODE STARTED!"

else

    ${nodeCommand} "${herdHomeDir}/herd.js" $@

fi
