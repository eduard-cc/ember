# shellcheck shell=bash
# Sourced by every Gym Log script that runs docker. Points the CLI at Gym Log's own
# rootless daemon (gym-log-docker.service), which cannot see other daemons' containers, and
# ignores any DOCKER_HOST the caller's shell exported. Only CI, which has a single
# throwaway daemon, may choose another one through GYM_LOG_DOCKER_HOST.
if [[ ${CI:-} == true && -n ${GYM_LOG_DOCKER_HOST:-} ]]; then
	export DOCKER_HOST=$GYM_LOG_DOCKER_HOST
else
	export DOCKER_HOST=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/gym-log/docker.sock
fi
unset DOCKER_CONTEXT
