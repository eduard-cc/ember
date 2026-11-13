#!/usr/bin/env bash
# ember.service's ExecStart: starts the release `current` points at. ops/install.sh installs
# it at ~/.local/lib/ember/start.sh, so advancing the checkout never changes what the unit
# runs, and ops/deploy.sh refuses an image release until the installed copy matches.
#
#   start.sh <runtime.env> <current release folder>
#
# An image release (an IMAGE file naming the image by digest) runs that image in Ember's
# Docker daemon, on the database's network, published on loopback only, read-only, without
# capabilities and with its own limits inside ember-live.slice. The daemon never pulls
# here: ops/deploy.sh pulled exactly that digest. A host-built release runs its server
# with the account's Node, as before.
#
# systemd has already loaded runtime.env into this environment (EnvironmentFile=), so the
# container gets exactly those variables, passed by name and never written anywhere, with
# the ones that differ inside the container replaced: the listen address, the image's web
# root and the database, which it reaches by name instead of the published loopback port.
set -Eeuo pipefail
export LC_ALL=C
[[ $# == 2 ]] || {
	echo 'usage: start.sh <runtime.env> <current release folder>' >&2
	exit 2
}
env_file=$1 current=$2

# Any IMAGE entry, even a broken link, makes it an image release: never fall back to Node.
if [[ ! -e $current/IMAGE && ! -L $current/IMAGE ]]; then
	cd -- "$current/server"
	exec "$HOME/.local/bin/node" "$current/server/dist/trial.js"
fi

refuse() {
	echo "ember-start: $*" >&2
	exit 1
}
[[ -f $current/IMAGE && ! -L $current/IMAGE ]] || refuse "$current/IMAGE is not a file"
image=$(<"$current/IMAGE") 2>/dev/null
# The same check as release_image in ops/lib.sh: one line, byte for byte.
if ! [[ $image =~ ^ghcr\.io/eduard-cc/ember@sha256:[0-9a-f]{64}$ ]] || ! cmp -s -- "$current/IMAGE" <(printf '%s\n' "$image"); then
	refuse "$current/IMAGE does not name the image by digest"
fi
[[ ${EMBER_PORT:-} =~ ^[0-9]+$ ]] || refuse 'EMBER_PORT is not set'
# The live database's published port, or the development daemon's.
database='^(postgres(ql)?://[^@/]+@)127\.0\.0\.1:5543[89](/[A-Za-z0-9_]+)$'
[[ ${EMBER_DATABASE_URL:-} =~ $database ]] ||
	refuse 'EMBER_DATABASE_URL is not the ember-postgres database on its loopback port'
export EMBER_DATABASE_URL=${BASH_REMATCH[1]}ember-postgres:5432${BASH_REMATCH[3]}
export EMBER_HOST=0.0.0.0 EMBER_WEB_ROOT=/app/web DOTENV_CONFIG_PATH=/dev/null

declare -A seen=()
forward=()
while read -r name; do
	# The image sets EMBER_CONTAINER itself.
	[[ -z ${seen[$name]:-} && $name != EMBER_CONTAINER ]] || continue
	seen[$name]=1
	forward+=(--env "$name")
# awk ends every name with a newline, even when the file's last line has none.
done < <(awk 'match($0, /^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=/) {
		name = substr($0, 1, RLENGTH - 1)
		sub(/^[[:space:]]+/, "", name)
		print name
	}' "$env_file"
	printf '%s\n' EMBER_HOST EMBER_WEB_ROOT DOTENV_CONFIG_PATH EMBER_DATABASE_URL)

exec docker --host "unix://${XDG_RUNTIME_DIR:?}/ember/docker.sock" run --rm --init --name ember-app \
	--pull never --network ember-local_default --publish "127.0.0.1:$EMBER_PORT:$EMBER_PORT" \
	--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
	--memory 768m --pids-limit 256 --cpus 1.5 \
	"${forward[@]}" "$image"
