#!/usr/bin/env bash
# Install or update the Gym Log user units. Idempotent; does not start or restart
# the app (ops/deploy.sh does that once a release exists).
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
units=$HOME/.config/systemd/user
mkdir -p "$units"
install -m 644 "$SCRIPT_DIR/systemd/gym-log.service" "$SCRIPT_DIR/systemd/gym-log-notify-failure@.service" "$units/"
systemctl --user daemon-reload
systemctl --user enable gym-log.service
echo 'gym-log-install: units installed; deploy with ops/deploy.sh <commit>'
