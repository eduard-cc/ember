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
# Reinstalling the same reviewed sources is idempotent.
cp "$here/notify.sh" "$HOME/src/ember/ops/notify.sh"
"$HOME/src/ember/ops/install.sh" >/dev/null
cmp "$here/notify.sh" "$HOME/.local/lib/ember/notify.sh"
echo 'installation and owner-side failure notification checks passed'
