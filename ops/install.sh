#!/usr/bin/env bash
# Install or update the Gym Log user units and slices. Idempotent; does not start or
# restart the app (ops/deploy.sh does that once a release exists). Slice limits apply on
# daemon-reload; a changed gym-log-docker.service needs a restart to take effect.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
units=$HOME/.config/systemd/user
mkdir -p "$units"
install -m 644 "$SCRIPT_DIR"/systemd/{gym-log.service,gym-log-notify-failure@.service,gym-log-docker.service} \
	"$SCRIPT_DIR"/systemd/{gym-log-live.slice,gym-log-jobs.slice} "$units/"
systemctl --user daemon-reload
systemctl --user enable gym-log-docker.service gym-log.service
echo 'gym-log-install: units installed; deploy with ops/deploy.sh <commit>'
