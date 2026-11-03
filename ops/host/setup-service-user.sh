#!/usr/bin/env bash
# Prepare the Ember service account's home: a pinned Node.js, the rootless Docker launcher
# from the docker.io package and the deploy checkout. Run as that account, from a reviewed
# copy (its own clone does not exist yet). Idempotent.
#
#   sudo /usr/local/sbin/ember-run -- \
#       bash -s -- <origin-url> <node-version> <ops/host/setup-service-user.sh
set -Eeuo pipefail
(($# == 2)) || {
	echo 'usage: setup-service-user.sh <origin-url> <node-version, e.g. v26.8.1>' >&2
	exit 2
}
origin=$1 node=$2
[[ $node =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo "not a Node.js version: $node" >&2
	exit 2
}
mkdir -p ~/.local/bin ~/.local/opt ~/bin ~/src
name=node-$node-linux-x64
if [[ ! -x ~/.local/opt/$name/bin/node ]]; then
	tmp=$(mktemp -d)
	trap 'rm -rf -- "$tmp"' EXIT
	curl -fsSL --max-time 300 -o "$tmp/$name.tar.xz" "https://nodejs.org/dist/$node/$name.tar.xz"
	curl -fsSL --max-time 30 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$node/SHASUMS256.txt"
	(cd "$tmp" && grep -E "^[0-9a-f]{64}  $name\.tar\.xz\$" SHASUMS256.txt | sha256sum --check --strict --quiet)
	tar -xJf "$tmp/$name.tar.xz" -C ~/.local/opt
fi
for tool in node npm npx; do ln -sfn "../opt/$name/bin/$tool" ~/.local/bin/"$tool"; done
# ember-docker.service starts %h/bin/dockerd-rootless.sh; this one uses the distribution's
# dockerd and rootlesskit, which AppArmor allows to create user namespaces.
ln -sfn /usr/share/docker.io/contrib/dockerd-rootless.sh ~/bin/dockerd-rootless.sh
[[ -d ~/src/ember/.git ]] || git clone --quiet -- "$origin" ~/src/ember
echo "setup-service-user: node $(~/.local/bin/node --version), checkout at ~/src/ember"
