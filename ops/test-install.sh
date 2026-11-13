#!/usr/bin/env bash
# Install into a synthetic HOME and dispatch the installed failure notifier and alert
# queue. No systemd state or external notifications are touched. Advancing the checkout
# must not change owner-side code that OnFailure or the retry unit executes.
set -Eeuo pipefail
here=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-install-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
export HOME=$sandbox/home
mkdir -p "$HOME/src/ember/ops" "$HOME/.local/bin" "$sandbox/bin"
cp "$here/install.sh" "$here/notify.sh" "$here/start.sh" "$HOME/src/ember/ops/"
cp -r "$here/systemd" "$HOME/src/ember/ops/"
printf '#!/bin/sh\nexit 0\n' >"$sandbox/bin/systemctl"
cat >"$HOME/.local/bin/hermes" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >"$HOME/alert"
EOF
chmod 755 "$sandbox/bin/systemctl" "$HOME/.local/bin/hermes"
export PATH=$sandbox/bin:$PATH
"$HOME/src/ember/ops/install.sh" >/dev/null
# A fetched commit changes the notifier source; an installed owner's unit must never
# execute it. The actual unit command (with systemd specifiers expanded) is exercised.
# shellcheck disable=SC2016 # the installed child shell expands HOME
printf '#!/bin/sh\ntouch "$HOME/checkout-code-ran"\n' >"$HOME/src/ember/ops/notify.sh"
python3 - <<'PY'
import configparser, os, shlex, subprocess
from pathlib import Path
home = Path.home()
def unit_command(name):
    unit = configparser.ConfigParser(interpolation=None)
    unit.read(home / '.config/systemd/user' / name)
    command = unit['Service']['ExecStart']
    for key, value in {'%h': str(home), '%H': 'test-host', '%i': 'test-unit'}.items():
        command = command.replace(key, value)
    return shlex.split(command)
subprocess.run(unit_command('ember-notify-failure@.service'), check=True)
subprocess.run(unit_command('ember-notify-retry.service'), check=True)  # an empty queue is done at once
path = configparser.ConfigParser(interpolation=None)
path.read(home / '.config/systemd/user/ember-notify-retry.path')
assert path['Path']['DirectoryNotEmpty'] == '%h/.local/state/ember/alert-queue', 'retry unit watches the wrong queue'
assert not (home / 'checkout-code-ran').exists(), 'owner-side notification executed checkout code'
alert = (home / 'alert').read_text()
assert 'test-unit failed.' in alert, 'owner-side alert was not dispatched'
assert '--to push' in alert, f'owner-side alert did not go to the Hermes app: {alert}'
PY
# With a Hermes webhook file the installed notifier posts a signed alert to it instead.
mkdir -p "$HOME/.config/ember"
python3 - "$HOME" <<'PY'
import configparser, hashlib, hmac, http.server, json, os, shlex, subprocess, sys, threading
from pathlib import Path
home = Path(sys.argv[1])
secret = 'synthetic-test-secret'
received = []
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers['Content-Length']))
        received.append((self.path, dict(self.headers), body))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"status": "delivered"}')
    def log_message(self, *args):
        pass
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
webhook = home / '.config/ember/hermes-webhook'
webhook.write_text(f'http://127.0.0.1:{server.server_port}/webhooks/ember-alerts\n{secret}\n')
os.chmod(webhook, 0o600)
subprocess.run([str(home / '.local/lib/ember/notify.sh'), '[ember]', 'Deploy of abc1234 failed.'], check=True)
server.shutdown()
assert len(received) == 1, 'no alert reached the Hermes webhook'
path, headers, body = received[0]
assert path == '/webhooks/ember-alerts', path
assert json.loads(body) == {'subject': '[ember]', 'message': 'Deploy of abc1234 failed.'}, body
signed = f"{headers['X-Webhook-Timestamp']}.".encode() + body
expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
assert hmac.compare_digest(headers['X-Webhook-Signature-V2'], expected), 'bad webhook signature'
assert 'test-unit failed.' in (home / 'alert').read_text(), 'the Hermes CLI fallback was used again'
notify = [str(home / '.local/lib/ember/notify.sh'), '[ember]']
def serve(handler):
    received.clear()
    Handler.do_POST = handler
    server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    webhook.write_text(f'http://127.0.0.1:{server.server_port}/webhooks/ember-alerts\n{secret}\n')
    return server
def answer(code, body=b''):
    def handler(self):
        length = int(self.headers['Content-Length'])
        received.append(json.loads(self.rfile.read(length))['message'])
        self.send_response(code)
        self.end_headers()
        self.wfile.write(body)
    return handler
cli_alert = (home / 'alert').read_text()
unit = configparser.ConfigParser(interpolation=None)
unit.read(home / '.config/systemd/user/ember-notify-retry.service')
retry = shlex.split(unit['Service']['ExecStart'].replace('%h', str(home)))
# A refused alert is not retried, not queued and fails, so the caller logs it.
server = serve(answer(403))
refused = subprocess.run(notify + ['Rollback failed.'], stderr=subprocess.PIPE, text=True)
server.shutdown()
assert refused.returncode == 1 and 'refused' in refused.stderr, refused
assert received == ['Rollback failed.'], f'a refused alert was retried: {received}'
# Hermes answers 200 "ignored" when its route drops an alert: that is not a delivery either.
server = serve(answer(200, b'{"status": "ignored", "reason": "script"}'))
ignored = subprocess.run(notify + ['Ignored alert.'], stderr=subprocess.PIPE, text=True)
server.shutdown()
assert ignored.returncode == 1 and 'did not deliver' in ignored.stderr, ignored
assert received == ['Ignored alert.'], f'an ignored alert was retried: {received}'
queue = home / '.local/state/ember/alert-queue'
assert not list(queue.glob('*')), 'a refused or ignored alert was queued'
assert (home / 'alert').read_text() == cli_alert, 'an alert went through the Hermes CLI'
# While Hermes is unreachable, alerts wait in the queue in order; once it is back, the
# retry unit sends them oldest first and empties the queue.
server = serve(answer(503))
first = subprocess.run(notify + ['Deploy of 1111111 failed.'], stderr=subprocess.PIPE, text=True)
server.shutdown()
assert first.returncode == 0 and 'queued' in first.stderr, first
assert len(received) == 3, f'an unreachable Hermes was tried {len(received)} times'
received.clear()
second = subprocess.run(notify + ['Deploy of 2222222 failed.'], stderr=subprocess.PIPE, text=True)
assert second.returncode == 0 and 'queued behind 1' in second.stderr, second
assert received == [], 'a new alert jumped the queue'
assert len(list(queue.glob('*.json'))) == 2, list(queue.iterdir())
assert all(p.stat().st_mode & 0o077 == 0 for p in queue.glob('*.json')), 'queued alerts are readable by others'
# Hermes is still away on the first try: the run waits and starts again from the oldest.
delivered = answer(200, b'{"status": "delivered"}')
def back_after_one_try(self):
    Handler.do_POST = delivered
    answer(503)(self)
server = serve(back_after_one_try)
flushed = subprocess.run(retry, env=dict(os.environ, EMBER_ALERT_RETRY_INTERVAL='0'), stderr=subprocess.PIPE,
                         text=True)
server.shutdown()
assert flushed.returncode == 0, flushed
assert received == ['Deploy of 1111111 failed.'] * 2 + ['Deploy of 2222222 failed.'], received
assert 'sent: [ember] Deploy of 2222222 failed.' in flushed.stderr, 'a delivered alert was not logged'
assert not list(queue.glob('*')), 'delivered alerts stayed queued'
# A queued alert Hermes refuses is not retried: it leaves the queue and the run fails.
server = serve(answer(503))
subprocess.run(notify + ['Deploy of 4444444 failed.'], check=True, stderr=subprocess.DEVNULL)
server.shutdown()
server = serve(answer(403))
refused = subprocess.run(retry, stderr=subprocess.PIPE, text=True, env=dict(os.environ, EMBER_ALERT_RETRY_INTERVAL='0'))
server.shutdown()
assert refused.returncode == 1 and 'refused' in refused.stderr and '4444444' in refused.stderr, refused
assert received == ['Deploy of 4444444 failed.'], f'a refused queued alert was retried: {received}'
assert not list(queue.glob('*')), 'a refused alert stayed queued'
# An alert Hermes never takes is given up after its maximum age, and the run fails so
# its OnFailure alert reports the loss. A rate-limited alert is retried like an unreachable one.
server = serve(answer(429))
subprocess.run(notify + ['Deploy of 3333333 failed.'], check=True, stderr=subprocess.DEVNULL)
gave_up = subprocess.run(retry, stderr=subprocess.PIPE, text=True,
                         env=dict(os.environ, EMBER_ALERT_RETRY_INTERVAL='0', EMBER_ALERT_MAX_AGE='0'))
server.shutdown()
assert gave_up.returncode == 1 and 'gave up' in gave_up.stderr and '3333333' in gave_up.stderr, gave_up
assert not list(queue.glob('*')), 'an expired alert stayed queued'
PY
# Reinstalling the same reviewed sources is idempotent.
cp "$here/notify.sh" "$HOME/src/ember/ops/notify.sh"
"$HOME/src/ember/ops/install.sh" >/dev/null
cmp "$here/notify.sh" "$HOME/.local/lib/ember/notify.sh"

# ember.service runs the installed launcher, never the checkout's copy, and the launcher
# starts either kind of release. Fake node and docker record how they were started.
cmp "$here/start.sh" "$HOME/.local/lib/ember/start.sh"
# shellcheck disable=SC2016 # the installed child shell expands HOME
printf '#!/bin/sh\ntouch "$HOME/checkout-code-ran"\n' >"$HOME/src/ember/ops/start.sh"
fail() {
	echo "install check failed: $*" >&2
	exit 1
}
started=$sandbox/started
cat >"$HOME/.local/bin/node" <<EOF
#!/usr/bin/env bash
{ echo "node \$PWD"; printf '%s\n' "\$@"; } >"$started"
EOF
cat >"$sandbox/bin/docker" <<EOF
#!/usr/bin/env bash
{
	echo docker
	printf '%s\n' "\$@"
	for name in EMBER_HOST EMBER_WEB_ROOT EMBER_DATABASE_URL EMBER_ORIGIN DOTENV_CONFIG_PATH; do
		echo "env \$name=\${!name-}"
	done
} >"$started"
EOF
chmod 755 "$HOME/.local/bin/node" "$sandbox/bin/docker"
export XDG_RUNTIME_DIR=$sandbox/run
ember=$HOME/.local/share/ember
mkdir -p "$ember/releases/host/server/dist" "$ember/releases/image/dist"
digest=$(printf 'a%.0s' {1..64})
echo "ghcr.io/eduard-cc/ember@sha256:$digest" >"$ember/releases/image/IMAGE"
# The synthetic runtime.env, with the database on the live loopback port.
env_file=$HOME/.config/ember/runtime.env
cat >"$env_file" <<EOF
EMBER_PORT=5191
EMBER_ORIGIN="https://ember.example.invalid"
EMBER_WEB_ROOT=$ember/current/dist
EMBER_DATABASE_URL=postgres://ember:synthetic@127.0.0.1:55438/ember
EOF
# Runs the unit's ExecStart as systemd would: specifiers expanded, runtime.env loaded.
launch() {
	local command
	command=$(sed -nE 's/^ExecStart=//p' "$HOME/.config/systemd/user/ember.service")
	command=${command//%h/$HOME}
	command=${command//%t/$XDG_RUNTIME_DIR}
	rm -f -- "$started"
	# shellcheck disable=SC1090,SC2086 # synthetic env file; the command line is split like systemd does
	(set -a && source "$env_file" && set +a && exec $command) 2>"$sandbox/launch.err"
}
ln -sfn releases/host "$ember/current"
launch || fail 'a host-built release should start'
[[ $(<"$started") == "node $ember/current/server"$'\n'"$ember/current/server/dist/trial.js" ]] ||
	fail "a host-built release must run its server with the account's Node: $(<"$started")"
[[ ! -e $HOME/checkout-code-ran ]] || fail 'ember.service executed checkout code'

ln -sfn releases/image "$ember/current"
launch || fail "an image release should start: $(<"$sandbox/launch.err")"
mapfile -t args <"$started"
expected=(docker --host "unix://$XDG_RUNTIME_DIR/ember/docker.sock" run --rm --init --name ember-app
	--pull never --network ember-local_default --publish 127.0.0.1:5191:5191
	--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges
	--memory 768m --pids-limit 256 --cpus 1.5
	--env EMBER_PORT --env EMBER_ORIGIN --env EMBER_WEB_ROOT --env EMBER_DATABASE_URL
	--env EMBER_HOST --env DOTENV_CONFIG_PATH "ghcr.io/eduard-cc/ember@sha256:$digest"
	env\ EMBER_HOST=0.0.0.0 env\ EMBER_WEB_ROOT=/app/web
	env\ EMBER_DATABASE_URL=postgres://ember:synthetic@ember-postgres:5432/ember
	'env EMBER_ORIGIN=https://ember.example.invalid' env\ DOTENV_CONFIG_PATH=/dev/null)
[[ ${args[*]} == "${expected[*]}" ]] || fail "unexpected container start: ${args[*]}"

# Anything but one image by digest, or a database other than ember-postgres's published
# port, is refused before docker runs.
refused() {
	launch && fail "$1 must be refused"
	[[ ! -e $started ]] || fail "$1 must not start anything"
}
for bad in 'ghcr.io/eduard-cc/ember:main' "ghcr.io/other/ember@sha256:$digest" "ghcr.io/eduard-cc/ember@sha256:${digest}0" \
	"ghcr.io/eduard-cc/ember@sha256:$digest --privileged" ''; do
	echo "$bad" >"$ember/releases/image/IMAGE"
	refused "IMAGE '$bad'"
done
printf 'ghcr.io/eduard-cc/ember@sha256:%s\n\n' "$digest" >"$ember/releases/image/IMAGE"
refused 'an IMAGE with a second line'
printf 'ghcr.io/eduard-cc/ember@sha256:%s\0' "$digest" >"$ember/releases/image/IMAGE"
refused 'an IMAGE ending in a NUL byte'
ln -sf /dev/null "$ember/releases/image/IMAGE"
refused 'an IMAGE symlink'
ln -sf "$sandbox/missing" "$ember/releases/image/IMAGE"
refused 'a dangling IMAGE symlink'
rm -- "$ember/releases/image/IMAGE"
echo "ghcr.io/eduard-cc/ember@sha256:$digest" >"$ember/releases/image/IMAGE"
cp "$env_file" "$sandbox/runtime.env.good"
for url in postgres://ember:synthetic@db.example.invalid:5432/ember postgres://ember:synthetic@127.0.0.1:5432/ember \
	'postgres://ember:synthetic@127.0.0.1:55438/ember?host=elsewhere'; do
	sed -i "s|^EMBER_DATABASE_URL=.*|EMBER_DATABASE_URL=$url|" "$env_file"
	refused "database $url"
done
cp "$sandbox/runtime.env.good" "$env_file"
launch || fail "the good release should start again: $(<"$sandbox/launch.err")"
# A runtime.env whose last line has no newline still passes every variable by its name.
printf 'EMBER_PORT=5191\nEMBER_DATABASE_URL=postgres://ember:synthetic@127.0.0.1:55438/ember\nEMBER_SESSION_SECURE=true' >"$env_file"
launch || fail "a runtime.env without a final newline should start: $(<"$sandbox/launch.err")"
if ! grep -qx 'EMBER_SESSION_SECURE' "$started" || ! grep -qx 'EMBER_HOST' "$started"; then
	fail "every variable must be passed by its own name: $(tr '\n' ' ' <"$started")"
fi
cp "$sandbox/runtime.env.good" "$env_file"
echo 'installation, launcher and owner-side failure notification checks passed'
