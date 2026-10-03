#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of the release switch, health check and rollback stack in ops/lib.sh,
# against a throwaway user unit and synthetic releases. Never touches gym-log.service,
# the live releases or the database. Needs systemd --user, so it is not run in CI.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/gym-log-release-test.XXXXXX")
unit=gym-log-release-test-$$.service
units=$HOME/.config/systemd/user
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
cleanup() {
	systemctl --user stop "$unit" 2>/dev/null || true
	rm -f -- "$units/$unit"
	systemctl --user daemon-reload
	systemctl --user reset-failed "$unit" 2>/dev/null || true
	rm -rf -- "$sandbox"
}
trap cleanup EXIT

export GYM_LOG_HOME=$sandbox/home GYM_LOG_ENV=$sandbox/runtime.env GYM_LOG_UNIT=$unit
mkdir -p "$GYM_LOG_HOME/releases"
printf 'GYM_LOG_PORT="%s"\nGYM_LOG_ORIGIN="http://127.0.0.1:%s"\nGYM_LOG_WEB_ROOT="%s"\n' \
	"$port" "$port" "$GYM_LOG_HOME/current/dist" >"$GYM_LOG_ENV"

# A synthetic release serves its own shell; a broken one exits at startup.
release() {
	local dir=$GYM_LOG_HOME/releases/$1
	mkdir -p "$dir/dist" "$dir/server/dist"
	echo "<!doctype html><title>$1</title>" >"$dir/dist/index.html"
	if [[ ${2:-} == broken ]]; then
		echo 'process.exit(1)' >"$dir/server/dist/trial.js"
	else
		cat >"$dir/server/dist/trial.js" <<-'EOF'
			const {readFileSync} = require('node:fs');
			require('node:http').createServer((req, res) => {
				if (req.url === '/api/v1/health') return res.end('{"status":"ready"}');
				res.end(readFileSync(process.env.GYM_LOG_WEB_ROOT + '/index.html'));
			}).listen(+process.env.GYM_LOG_PORT, '127.0.0.1');
		EOF
	fi
	touch "$dir/.complete"
}
cat >"$units/$unit" <<EOF
[Service]
EnvironmentFile=$GYM_LOG_ENV
ExecStart=$HOME/.local/bin/node $GYM_LOG_HOME/current/server/dist/trial.js
EOF
systemctl --user daemon-reload

ACTION='test'
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"
fail() {
	echo "FAIL: $*" >&2
	exit 1
}
serving() { [[ $(curl -fsS "http://127.0.0.1:$port/") == "<!doctype html><title>$1</title>" ]]; }
deploy() {
	point_current "$1"
	restart_and_check || return 1
	local history=()
	[[ -f $HISTORY ]] && mapfile -t history <"$HISTORY"
	write_history "${history[@]}" "$1"
}

check_config
release aaa
release bbb
release ccc
release bad broken
deploy aaa && deploy bbb && deploy ccc || fail 'healthy deploys'
serving ccc || fail 'ccc should serve after deploy'

# An unhealthy release fails the check, and roll_back restores the last healthy one.
point_current bad
restart_and_check 2>/dev/null && fail 'a crashing release must fail the health check'
roll_back >/dev/null || fail 'rollback from a broken release'
[[ $(current_release) == ccc ]] && serving ccc || fail 'broken release should roll back to ccc'

# Repeated rollbacks walk back through the history, then stop.
roll_back >/dev/null && serving bbb || fail 'first rollback should serve bbb'
roll_back >/dev/null && serving aaa || fail 'second rollback should serve aaa'
roll_back 2>/dev/null && fail 'rollback with no earlier release must fail'
serving aaa || fail 'a refused rollback must leave aaa serving'

# A missing or incomplete release is skipped, never switched to.
deploy bbb && deploy ccc || fail 'redeploys'
rm -f -- "$GYM_LOG_HOME/releases/bbb/.complete"
roll_back >/dev/null && serving aaa || fail 'rollback should skip incomplete bbb'
echo 'release switch checks passed'
