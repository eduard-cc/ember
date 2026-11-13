#!/usr/bin/env bash
# Prepare the Ember service account's home: the rootless Docker launcher from the docker.io
# package and the deploy checkout. The app runs from its image, with the image's own Node.
# Run as that account, from a reviewed copy (its own clone does not exist yet). Idempotent.
#
#   sudo /usr/local/sbin/ember-run -- \
#       bash -s -- <origin-url> <ops/host/setup-service-user.sh
set -Eeuo pipefail
(($# == 1)) || {
	echo 'usage: setup-service-user.sh <origin-url>' >&2
	exit 2
}
origin=$1
mkdir -p ~/bin ~/src
# ember-docker.service starts %h/bin/dockerd-rootless.sh; this one uses the distribution's
# dockerd and rootlesskit, which AppArmor allows to create user namespaces.
ln -sfn /usr/share/docker.io/contrib/dockerd-rootless.sh ~/bin/dockerd-rootless.sh
[[ -d ~/src/ember/.git ]] || git clone --quiet -- "$origin" ~/src/ember
echo 'setup-service-user: checkout at ~/src/ember'
