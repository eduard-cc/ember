# shellcheck shell=bash
# Sourced by every Ember script that runs docker. Points the CLI at Ember's own
# rootless daemon (ember-docker.service), which cannot see other daemons' containers, and
# ignores any DOCKER_HOST the caller's shell exported. Only CI, which has a single
# throwaway daemon, may choose another one through EMBER_DOCKER_HOST.
if [[ ${CI:-} == true && -n ${EMBER_DOCKER_HOST:-} ]]; then
	export DOCKER_HOST=$EMBER_DOCKER_HOST
else
	export DOCKER_HOST=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/ember/docker.sock
fi
unset DOCKER_CONTEXT
