#!/usr/bin/env bash
# The Docker CLI for Ember: same arguments as docker, always against Ember's own
# rootless daemon. Use it for every Ember container command, for example
#   ops/docker.sh compose -f ops/compose.local.yml up -d --wait
#   ops/docker.sh exec ember-postgres pg_isready
set -Eeuo pipefail
# shellcheck source=ops/docker-host.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/docker-host.sh"
exec docker "$@"
