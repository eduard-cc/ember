#!/usr/bin/env bash
# Install or update the Ember user units and slices. Idempotent; does not start or
# restart the app (ops/deploy.sh does that once a release exists). Slice limits apply on
# daemon-reload; a changed ember-docker.service needs a restart to take effect. Starts
# ember-auto-deploy.timer, which deploys main once its CI has passed, and
# ember-notify-retry.path, which sends alerts queued while Hermes was unreachable.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
units=$HOME/.config/systemd/user
mkdir -p "$units" "$HOME/.local/lib/ember"
# Owner-side OnFailure and ember.service must never execute a script that changes when
# main advances.
install -m 755 "$SCRIPT_DIR/notify.sh" "$HOME/.local/lib/ember/notify.sh"
install -m 755 "$SCRIPT_DIR/start.sh" "$HOME/.local/lib/ember/start.sh"
install -m 644 "$SCRIPT_DIR"/systemd/{ember.service,ember-notify-failure@.service,ember-docker.service} \
	"$SCRIPT_DIR"/systemd/{ember-tailscale.service,ember-live.slice,ember-jobs.slice} \
	"$SCRIPT_DIR"/systemd/{ember-auto-deploy.service,ember-auto-deploy.timer} \
	"$SCRIPT_DIR"/systemd/{ember-notify-retry.service,ember-notify-retry.path} "$units/"
systemctl --user daemon-reload
systemctl --user enable ember-docker.service ember.service ember-tailscale.service
systemctl --user enable --now ember-auto-deploy.timer ember-notify-retry.path
echo 'ember-install: units installed; main deploys itself, or run ops/deploy.sh <commit>'
