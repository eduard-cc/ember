# shellcheck shell=bash
# Read-only Ember live check. Run from a checkout: sudo -n /usr/local/sbin/ember-run -- bash -s < ops/livecheck.sh
# Prints the current release, deploy journal tail, health (loopback and Serve), shell/sw.js byte matches and the hold.
# Never prints the origin URL or runtime.env values.
set -u
S=~/.local/share/ember
E=~/.config/ember/runtime.env
val() { v=$(sed -nE "s/^$1=//p" "$E" | tail -n 1); v=${v#\"}; echo "${v%\"}"; }
cur=$(basename "$(readlink "$S/current")")
echo "current release: $cur"
echo "checkout head: $(git -C ~/src/ember rev-parse HEAD 2>/dev/null)"
echo "--- deploy journal (last lines)"
journalctl --user -u ember-auto-deploy -n 8 --no-pager -o cat 2>/dev/null
echo "IMAGE: $(cat "$S/current/IMAGE" 2>/dev/null)"
port=$(val EMBER_PORT); origin=$(val EMBER_ORIGIN)
echo "health loopback: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$port/api/v1/health")"
echo "health serve: $(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$origin/api/v1/health")"
curl -fsS --max-time 10 "$origin/sw.js" | cmp -s - "$S/current/dist/sw.js" && echo 'sw.js via Serve: byte MATCH' || echo 'sw.js via Serve: MISMATCH'
curl -fsS --max-time 10 "http://127.0.0.1:$port/sw.js" | cmp -s - "$S/current/dist/sw.js" && echo 'sw.js loopback: byte MATCH' || echo 'sw.js loopback: MISMATCH'
curl -fsS --max-time 10 "$origin/" | cmp -s - "$S/current/dist/index.html" && echo 'shell via Serve: byte MATCH' || echo 'shell via Serve: MISMATCH'
echo "hold: $(cat "$S/auto-deploy.hold" 2>/dev/null)"
systemctl --user is-active ember.service
