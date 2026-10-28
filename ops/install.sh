#!/usr/bin/env bash
# Install or update the Ember user units and slices. Idempotent; does not start or
# restart the app (ops/deploy.sh does that once a release exists). Slice limits apply on
# daemon-reload; a changed ember-docker.service needs a restart to take effect.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
units=$HOME/.config/systemd/user
mkdir -p "$units"
install -m 644 "$SCRIPT_DIR"/systemd/{ember.service,ember-notify-failure@.service,ember-docker.service} \
	"$SCRIPT_DIR"/systemd/{ember-tailscale.service,ember-live.slice,ember-jobs.slice} "$units/"
systemctl --user daemon-reload
systemctl --user enable ember-docker.service ember.service ember-tailscale.service
echo 'ember-install: units installed; deploy with ops/deploy.sh <commit>'
