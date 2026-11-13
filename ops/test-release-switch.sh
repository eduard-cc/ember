#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of the release switch, health check and rollback stack in ops/lib.sh, and of
# ops/start.sh, against a throwaway user unit, synthetic releases and a fake docker whose
# "container" is a synthetic server. Never touches ember.service, the live releases, a
# Docker daemon or the database. Needs systemd --user, so it is not run in CI.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-release-test.XXXXXX")
unit=ember-release-test-$$.service
units=$HOME/.config/systemd/user
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
inner=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
cleanup() {
	systemctl --user stop "$unit" 2>/dev/null || true
	rm -f -- "$units/$unit"
	systemctl --user daemon-reload
	systemctl --user reset-failed "$unit" 2>/dev/null || true
	rm -rf -- "$sandbox"
}
trap cleanup EXIT

export EMBER_HOME=$sandbox/home EMBER_ENV=$sandbox/runtime.env EMBER_UNIT=$unit EMBER_DOCKER_UNIT=$unit
mkdir -p "$EMBER_HOME/releases" "$sandbox/bin" "$sandbox/images"
printf 'EMBER_PORT="%s"\nEMBER_ORIGIN="http://127.0.0.1:%s"\n' "$port" "$port" >"$EMBER_ENV"
echo 'EMBER_DATABASE_URL=postgres://synthetic@127.0.0.1:55439/ember_test' >>"$EMBER_ENV"

# A synthetic image release: its web shell in dist/, and in the "image" (under images/) the
# same shell and a server that serves it and the files its service worker precaches; a
# broken one exits at startup. Like the real server, it refuses PNGs under assets/, so an
# "unserved" release, whose worker precaches one, 404s on it.
release() { # <release> [unserved|broken]
	local dir=$EMBER_HOME/releases/$1 digest extra=
	digest=$(sha256sum <<<"$1" | cut -c1-64)
	mkdir -p "$dir/dist/assets"
	echo "<!doctype html><title>$1</title>" >"$dir/dist/index.html"
	echo "{\"name\": \"$1\"}" >"$dir/dist/manifest.webmanifest"
	echo "console.log('$1')" >"$dir/dist/assets/index-$1.js"
	if [[ ${2:-} == unserved ]]; then
		echo "synthetic drawing $1" >"$dir/dist/assets/drawing-$1.png"
		extra=",\"/assets/drawing-$1.png\""
	fi
	printf 'const CACHE = "ember-shell-%s";\nconst URLS = ["/index.html","/assets/index-%s.js"%s,"/manifest.webmanifest"];\n' \
		"$1" "$1" "$extra" >"$dir/dist/sw.js"
	rm -rf -- "$sandbox/images/$digest"
	cp -r -- "$dir/dist" "$sandbox/images/$digest"
	if [[ ${2:-} == broken ]]; then
		echo 'process.exit(1)' >"$sandbox/images/$digest.js"
	else
		cat >"$sandbox/images/$digest.js" <<-'EOF'
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
	echo "ghcr.io/eduard-cc/ember@sha256:$digest" >"$dir/IMAGE"
	touch "$dir/.complete"
}

# The daemon's port forwarder: listens on the published port, forwards to the container's
# server and exits with it. Like the real daemon's rootlesskit, the process that listens on
# the port is called rootlesskit and lives in the Docker unit (here the test unit itself).
# Node renames its own process, so this one is Python.
cat >"$sandbox/forwarder.py" <<'EOF'
import os, socket, sys, threading, time
port, inner, child = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
def pipe(a, b):
    try:
        while data := a.recv(65536):
            b.sendall(data)
    except OSError:
        pass
    finally:
        for s in (a, b):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
def accept(server):
    while True:
        client, _ = server.accept()
        try:
            upstream = socket.create_connection(('127.0.0.1', inner))
        except OSError:
            client.close()
            continue
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()
server = socket.create_server(('127.0.0.1', port))
threading.Thread(target=accept, args=(server,), daemon=True).start()
while True:
    try:
        os.kill(child, 0)
        if open(f'/proc/{child}/stat').read().split(') ')[1][0] == 'Z':
            raise ProcessLookupError
    except (ProcessLookupError, FileNotFoundError):
        sys.exit(1)
    time.sleep(0.2)
EOF
ln -sfn "$(command -v python3)" "$sandbox/bin/rootlesskit"
node=$(command -v node)
cat >"$sandbox/bin/docker" <<EOF
#!/usr/bin/env bash
# Fake docker: run, image inspect and inspect, for synthetic images only.
[[ \$1 != --host ]] || shift 2
command=\$1
shift
digest() { local d=\${1#ghcr.io/eduard-cc/ember@sha256:}; [[ -f $sandbox/images/\$d.js ]] && echo "\$d"; }
case \$command in
run)
	entrypoint=
	while [[ \$1 == -* ]]; do
		case \$1 in
		--entrypoint) entrypoint=\$2 && shift 2 ;;
		--name | --network | --publish | --tmpfs | --memory | --pids-limit | --cpus | --env | --security-opt | --cap-drop | --pull) shift 2 ;;
		*) shift ;;
		esac
	done
	d=\$(digest "\$1") || { echo "no such image \$1" >&2; exit 125; }
	shift
	[[ \$entrypoint != node ]] || exec "$node" "\$@"
	echo "\$d \$\$" >"$sandbox/container"
	export EMBER_WEB_ROOT=$sandbox/images/\$d
	[[ ! -e $sandbox/images/\$d/unpublished ]] || exec "$node" "$sandbox/images/\$d.js"
	EMBER_PORT=$inner "$node" "$sandbox/images/\$d.js" &
	exec "$sandbox/bin/rootlesskit" -I "$sandbox/forwarder.py" "$port" "$inner" "\$!"
	;;
image)
	d=\$(digest "\${@: -1}") && echo "sha256:id-\$d"
	;;
inspect)
	read -r d pid <"$sandbox/container" 2>/dev/null && kill -0 "\$pid" 2>/dev/null || exit 1
	echo "true sha256:id-\$d 127.0.0.1:$port "
	;;
*) exit 1 ;;
esac
EOF
chmod +x "$sandbox/bin/docker"
cp -- "$SCRIPT_DIR/start.sh" "$sandbox/start.sh"
cat >"$units/$unit" <<EOF
[Service]
Environment=PATH=$sandbox/bin:/usr/bin:/bin XDG_RUNTIME_DIR=$sandbox/run
EnvironmentFile=$EMBER_ENV
ExecStart=$sandbox/start.sh $EMBER_ENV $EMBER_HOME/current
EOF
systemctl --user daemon-reload
# The health check's own docker calls run in this shell.
PATH=$sandbox/bin:$PATH

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

# switch_release rolls a failed switch back and alerts the owner.
touch "$EMBER_HOME/releases/bbb/.complete"
deploy bbb || fail 'redeploy bbb'
alerts=$sandbox/alerts
notify() { echo "$1" >>"$alerts"; }
switched() { # <sha>; prints switch_release's exit status
	local rc=0
	switch_release "$@" >/dev/null 2>&1 || rc=$?
	echo "$rc"
}
# A crashing release rolls back and says so.
: >"$alerts"
[[ $(switched bad) == 1 && $(current_release) == bbb ]] || fail 'a broken release must roll back'
grep -q 'failed its health check, so it was rolled back to bbb. Migrations are not rolled back' "$alerts" ||
	fail 'a broken release must alert the owner'
# The server never logs a 404, so the alert itself names the missing offline file.
: >"$alerts"
[[ $(switched unserved) == 1 && $(current_release) == bbb ]] || fail 'an unserved release must roll back'
grep -q 'unserved failed its health check (Serve did not return /assets/drawing-unserved.png)' "$alerts" ||
	fail 'the alert must name the unserved file'
: >"$alerts"
[[ $(switched ccc) == 0 ]] && serving ccc || fail 'a healthy switch should pass'
[[ ! -s $alerts ]] || fail 'a healthy switch must not alert'
# A link that cannot be switched changes nothing and does not roll back.
mkdir -p "$EMBER_HOME/current.tmp/blocker"
[[ $(switched bbb) == 3 && $(current_release) == ccc ]] || fail 'a failed link switch must leave the release alone'
rm -rf -- "$EMBER_HOME/current.tmp"

# More image releases: a crashing one, and one whose server listens itself instead of the
# daemon publishing the port.
release iii
release jjj
release kkk broken
release lll
touch "$sandbox/images/$(sha256sum <<<lll | cut -c1-64)/unpublished"

# A release built on the host (dist/ and server/, no IMAGE) is skipped by rollback: the
# launcher cannot start it.
mkdir -p "$EMBER_HOME/releases/hhh/dist" "$EMBER_HOME/releases/hhh/server/dist"
touch "$EMBER_HOME/releases/hhh/.complete"
deploy iii || fail 'a healthy release should switch'
printf '%s\n' bbb hhh iii >"$HISTORY"
deploy jjj && serving jjj || fail 'a second release should switch'
roll_back >/dev/null && serving iii || fail 'rollback to the previous release'
roll_back 2>"$sandbox/skip.log" >/dev/null && [[ $(current_release) == bbb ]] && serving bbb ||
	fail 'rollback must skip a release built on the host'
grep -q 'skipping hhh: it is not an image release' "$sandbox/skip.log" || fail 'the skipped release must be named'
deploy iii && serving iii || fail 'roll forward'
# A crashing image, or a port the daemon does not publish, fails and rolls back.
: >"$alerts"
[[ $(switched kkk) == 1 && $(current_release) == iii ]] && serving iii || fail 'a crashing image must roll back'
grep -q 'kkk failed its health check, so it was rolled back to iii' "$alerts" || fail 'a crashing image must alert'
[[ $(switched lll) == 1 && $(current_release) == iii ]] && serving iii ||
	fail 'a port not published by the Docker unit must fail the check'
# A running container from another image than the release names is not this release.
point_current jjj
EMBER_START_TIMEOUT=4 healthy 2>"$sandbox/other-image.log" && fail 'a container of another image must fail the check'
grep -q 'ember-app is not running' "$sandbox/other-image.log" || fail 'the check must name the wrong container'
point_current iii
# An IMAGE that does not name the image by digest never starts, and rolls back.
release mmm
echo 'ghcr.io/eduard-cc/ember:main' >"$EMBER_HOME/releases/mmm/IMAGE"
[[ $(switched mmm) == 1 && $(current_release) == iii ]] && serving iii || fail 'a release naming a tag must roll back'
echo 'release switch checks passed'
