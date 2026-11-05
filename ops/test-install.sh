#!/usr/bin/env bash
# Install into a synthetic HOME and dispatch the installed failure notifier. No systemd
# state or external notifications are touched. Advancing the checkout must not change
# owner-side code that OnFailure executes.
set -Eeuo pipefail
here=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-install-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
export HOME=$sandbox/home
mkdir -p "$HOME/src/ember/ops" "$HOME/.local/bin" "$sandbox/bin"
cp "$here/install.sh" "$here/notify.sh" "$HOME/src/ember/ops/"
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
unit = configparser.ConfigParser(interpolation=None)
unit.read(home / '.config/systemd/user/ember-notify-failure@.service')
command = unit['Service']['ExecStart']
for key, value in {'%h': str(home), '%H': 'test-host', '%i': 'test-unit'}.items():
    command = command.replace(key, value)
subprocess.run(shlex.split(command), check=True)
assert not (home / 'checkout-code-ran').exists(), 'owner-side notification executed checkout code'
assert 'test-unit failed.' in (home / 'alert').read_text(), 'owner-side alert was not dispatched'
PY
# With a Hermes webhook file the installed notifier posts a signed alert to it instead.
mkdir -p "$HOME/.config/ember"
python3 - "$HOME" <<'PY'
import hashlib, hmac, http.server, json, os, subprocess, sys, threading
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
# A refused alert is not retried and falls back to the next channel.
received.clear()
Handler.do_POST = lambda self: (received.append(self.path), self.send_response(403), self.end_headers())
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
webhook.write_text(f'http://127.0.0.1:{server.server_port}/webhooks/ember-alerts\n{secret}\n')
subprocess.run([str(home / '.local/lib/ember/notify.sh'), '[ember]', 'Rollback failed.'], check=True,
               stderr=subprocess.DEVNULL)
server.shutdown()
assert len(received) == 1, f'a refused alert was retried {len(received)} times'
assert 'Rollback failed.' in (home / 'alert').read_text(), 'a refused alert did not fall back'
# Hermes answers 200 "ignored" when its route drops an alert: that falls back too.
def ignored(self):
    received.append(self.path)
    self.send_response(200)
    self.end_headers()
    self.wfile.write(b'{"status": "ignored", "reason": "script"}')
Handler.do_POST = ignored
received.clear()
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
webhook.write_text(f'http://127.0.0.1:{server.server_port}/webhooks/ember-alerts\n{secret}\n')
subprocess.run([str(home / '.local/lib/ember/notify.sh'), '[ember]', 'Ignored alert.'], check=True,
               stderr=subprocess.DEVNULL)
server.shutdown()
assert len(received) == 1, f'an ignored alert was retried {len(received)} times'
assert 'Ignored alert.' in (home / 'alert').read_text(), 'an ignored alert did not fall back'
PY
# Reinstalling the same reviewed sources is idempotent.
cp "$here/notify.sh" "$HOME/src/ember/ops/notify.sh"
"$HOME/src/ember/ops/install.sh" >/dev/null
cmp "$here/notify.sh" "$HOME/.local/lib/ember/notify.sh"
echo 'installation and owner-side failure notification checks passed'
