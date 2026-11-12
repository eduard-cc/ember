#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of the release switch, health check and rollback stack in ops/lib.sh,
# against a throwaway user unit and synthetic releases. Never touches ember.service,
# the live releases or the database. Needs systemd --user, so it is not run in CI.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-release-test.XXXXXX")
unit=ember-release-test-$$.service
units=$HOME/.config/systemd/user
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
cleanup() {
	[[ -z ${shell_pid:-} ]] || kill "$shell_pid" 2>/dev/null || true
	systemctl --user stop "$unit" 2>/dev/null || true
	rm -f -- "$units/$unit"
	systemctl --user daemon-reload
	systemctl --user reset-failed "$unit" 2>/dev/null || true
	rm -rf -- "$sandbox"
}
trap cleanup EXIT

export EMBER_HOME=$sandbox/home EMBER_ENV=$sandbox/runtime.env EMBER_UNIT=$unit
mkdir -p "$EMBER_HOME/releases"
printf 'EMBER_PORT="%s"\nEMBER_ORIGIN="http://127.0.0.1:%s"\nEMBER_WEB_ROOT="%s"\nEMBER_EXTRA_HEALTH_URLS="file://%s/extra-health"\n' \
	"$port" "$port" "$EMBER_HOME/current/dist" "$sandbox" >"$EMBER_ENV"

# A synthetic release serves its own shell and the files its service worker precaches;
# a broken one exits at startup. Like the real server, it refuses PNGs under assets/, so
# an "unserved" release, whose worker precaches one, 404s on it.
release() {
	local dir=$EMBER_HOME/releases/$1 extra=
	mkdir -p "$dir/dist/assets" "$dir/server/dist"
	echo "<!doctype html><title>$1</title>" >"$dir/dist/index.html"
	echo "{\"name\": \"$1\"}" >"$dir/dist/manifest.webmanifest"
	echo "console.log('$1')" >"$dir/dist/assets/index-$1.js"
	if [[ ${2:-} == unserved ]]; then
		echo "synthetic drawing $1" >"$dir/dist/assets/drawing-$1.png"
		extra=",\"/assets/drawing-$1.png\""
	fi
	printf 'const CACHE = "ember-shell-%s";\nconst URLS = ["/index.html","/assets/index-%s.js"%s,"/manifest.webmanifest"];\n' \
		"$1" "$1" "$extra" >"$dir/dist/sw.js"
	if [[ ${2:-} == broken ]]; then
		echo 'process.exit(1)' >"$dir/server/dist/trial.js"
	else
		cat >"$dir/server/dist/trial.js" <<-'EOF'
			const {existsSync, readFileSync} = require('node:fs');
			require('node:http').createServer((req, res) => {
				if (req.url === '/api/v1/health') return res.end('{"status":"ready"}');
				const file = process.env.EMBER_WEB_ROOT + (req.url === '/' ? '/index.html' : req.url);
				if (/^\/assets\/.*\.png$/.test(req.url) || !existsSync(file)) {
					res.statusCode = 404;
					return res.end();
				}
				res.end(readFileSync(file));
			}).listen(+process.env.EMBER_PORT, '127.0.0.1');
		EOF
	fi
	touch "$dir/.complete"
}
cat >"$units/$unit" <<EOF
[Service]
EnvironmentFile=$EMBER_ENV
ExecStart=$HOME/.local/bin/node $EMBER_HOME/current/server/dist/trial.js
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

# A release whose service worker precaches a file the server refuses fails the check
# quickly (a 404 is not retried), names the file, and rolls back.
release unserved unserved
point_current unserved
started=$SECONDS
restart_and_check 2>"$sandbox/unserved.log" && fail 'a release with an unserved precached file must fail the health check'
grep -q '/assets/drawing-unserved.png' "$sandbox/unserved.log" || fail 'the failed health check must name the unserved file'
((SECONDS - started < 15)) || fail "a 404 must fail fast, took $((SECONDS - started))s"
roll_back >/dev/null && [[ $(current_release) == aaa ]] && serving aaa || fail 'an unserved release should roll back to aaa'
# A release missing its service worker is not a complete shell either.
release noworker
rm -- "$EMBER_HOME/releases/noworker/dist/sw.js"
point_current noworker
restart_and_check 2>/dev/null && fail 'a release without sw.js must fail the health check'
roll_back >/dev/null && [[ $(current_release) == aaa ]] || fail 'a release without sw.js should roll back to aaa'

# A missing or incomplete release is skipped, never switched to.
deploy bbb && deploy ccc || fail 'redeploys'
rm -f -- "$EMBER_HOME/releases/bbb/.complete"
roll_back >/dev/null && serving aaa || fail 'rollback should skip incomplete bbb'

# Extra-endpoint tripwire. A file stands in for an extra health endpoint; the "harmful" release
# removes it on startup, as if the Ember switch had taken it down.
touch "$EMBER_HOME/releases/bbb/.complete"
deploy bbb || fail 'redeploy bbb'
export EMBER_EXTRA_HEALTH_URLS="file://$sandbox/extra-health" EMBER_EXTRA_GRACE=4
release harmful
sed -i "1i require('node:fs').rmSync('$sandbox/extra-health', {force: true});" \
	"$EMBER_HOME/releases/harmful/server/dist/trial.js"
alerts=$sandbox/alerts
notify() { echo "$1" >>"$alerts"; }
switched() { # <sha> <extra_before>; prints switch_release's exit status
	local rc=0
	switch_release "$@" >/dev/null 2>&1 || rc=$?
	echo "$rc"
}
touch "$sandbox/extra-health"
extra_healthy || fail 'the fake extra endpoint should start healthy'
# A URL that falls through to a web shell (HTML) is not a health check.
mkdir -p "$sandbox/shell"
echo '<!doctype html>' >"$sandbox/shell/index.html"
shell_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -m http.server --bind 127.0.0.1 --directory "$sandbox/shell" "$shell_port" >/dev/null 2>&1 &
shell_pid=$!
shell_up=false
for _ in $(seq 1 50); do
	curl -fsS -o /dev/null "http://127.0.0.1:$shell_port/" 2>/dev/null && shell_up=true && break
	sleep 0.1
done
[[ $shell_up == true ]] || { kill "$shell_pid" 2>/dev/null; fail 'the fake HTML shell server did not start'; }
shell_healthy=false
EMBER_EXTRA_HEALTH_URLS="http://127.0.0.1:$shell_port/" extra_healthy && shell_healthy=true
kill "$shell_pid" && wait "$shell_pid" 2>/dev/null || true
[[ $shell_healthy == false ]] || fail 'an HTML page must not count as a healthy endpoint'
# runtime.env supplies the URLs when the environment does not; the environment wins.
echo "EMBER_EXTRA_HEALTH_URLS=\"file://$sandbox/from-env-file\"" >>"$EMBER_ENV"
[[ $(EMBER_EXTRA_HEALTH_URLS='' extra_urls) == "file://$sandbox/from-env-file" ]] ||
	fail 'extra_urls should read EMBER_EXTRA_HEALTH_URLS from runtime.env'
[[ $(extra_urls) == "file://$sandbox/extra-health" ]] ||
	fail 'the EMBER_EXTRA_HEALTH_URLS environment variable should override runtime.env'
# A malformed list must stop the deploy instead of silently disabling the guard.
(EMBER_EXTRA_HEALTH_URLS="'http://127.0.0.1:1/x'" check_config) 2>/dev/null &&
	fail 'check_config must reject a quoted extra health URL'
(EMBER_EXTRA_HEALTH_URLS='http://127.0.0.1:1/x #note' check_config) 2>/dev/null &&
	fail 'check_config must reject an extra health URL list with a comment'
# The URLs are host configuration with no built-in default: a runtime.env without them
# stops the deploy.
grep -v '^EMBER_EXTRA_HEALTH_URLS=' "$EMBER_ENV" >"$sandbox/no-extra.env"
(EMBER_EXTRA_HEALTH_URLS='' EMBER_ENV=$sandbox/no-extra.env check_config) 2>/dev/null &&
	fail 'check_config must refuse a runtime.env without EMBER_EXTRA_HEALTH_URLS'
check_config || fail 'check_config should accept the test URLs'
[[ $(switched harmful true) == 1 ]] || fail 'a switch that breaks the extra endpoints must roll back'
[[ $(current_release) == bbb ]] && serving bbb || fail 'extra-endpoint breakage should roll back to bbb'
grep -q 'The extra health endpoints stopped responding after Ember deployed harmful.*rolled back to bbb.*STILL unhealthy' "$alerts" ||
	fail 'extra-endpoint breakage must alert the owner'
# Extra endpoints already down before the deploy: they cannot gate the switch.
[[ $(switched ccc false) == 0 ]] && serving ccc || fail 'unhealthy extra endpoints before the deploy must not block it'
touch "$sandbox/extra-health"
# A crashing release still rolls back through the same path, and says so.
: >"$alerts"
[[ $(switched bad true) == 1 && $(current_release) == bbb ]] || fail 'a broken release must roll back'
grep -q 'failed its health check, so it was rolled back to bbb. The extra endpoints are healthy again' "$alerts" ||
	fail 'a broken release must alert the owner'
# The server never logs a 404, so the alert itself names the missing offline file.
: >"$alerts"
[[ $(switched unserved true) == 1 && $(current_release) == bbb ]] || fail 'an unserved release must roll back'
grep -q 'unserved failed its health check (Serve did not return /assets/drawing-unserved.png)' "$alerts" ||
	fail 'the alert must name the unserved file'
[[ $(switched ccc true) == 0 ]] && serving ccc || fail 'a harmless switch with the extra endpoints healthy should pass'
# A release that applied migrations is never rolled back onto the old schema for the
# extra endpoints' sake: it stays live and the owner is asked to check.
: >"$alerts"
[[ $(switched harmful true true) == 4 ]] || fail 'a migrated release must not roll back for the extra endpoints'
[[ $(current_release) == harmful ]] && serving harmful || fail 'the migrated release should stay live'
grep -q 'NOT rolled back because this release applied database migrations' "$alerts" ||
	fail 'a migrated release must still alert the owner'
touch "$sandbox/extra-health"
# A link that cannot be switched changes nothing and does not roll back.
mkdir -p "$EMBER_HOME/current.tmp/blocker"
[[ $(switched ccc true) == 3 && $(current_release) == harmful ]] || fail 'a failed link switch must leave the release alone'
rm -rf -- "$EMBER_HOME/current.tmp"
echo 'release switch checks passed'
