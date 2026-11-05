#!/usr/bin/env bash
# Send one alert to the owner.
#
#   ops/notify.sh <subject> <message>
#
# The Ember service account has no Hermes login. It posts the alert to the owner's Hermes
# webhook, which forwards it to the Hermes app as a push notification: the file
# ~/.config/ember/hermes-webhook (mode 0600) holds the route URL on its first line and the
# route's HMAC secret on its second. Without that file, or when Hermes does not take the
# alert, it posts to the Discord webhook whose URL is the only line of
# ~/.config/ember/discord-webhook (mode 0600), and without either the alert goes through
# `hermes send` to the Hermes app (push), as on an owner-run install. Neither the URL nor the secret
# ever appears on a command line, where other local users could read it.
set -Eeuo pipefail
(($# == 2)) || {
	echo "usage: $(basename "$0") <subject> <message>" >&2
	exit 2
}
export PATH=$HOME/.local/bin:$PATH
hermes_webhook=${EMBER_HERMES_WEBHOOK_FILE:-$HOME/.config/ember/hermes-webhook}
if [[ -e $hermes_webhook ]] && python3 -I - "$hermes_webhook" "$1" "$2" <<'PY'
import hashlib, hmac, json, re, sys, time, urllib.error, urllib.request
path, subject, message = sys.argv[1:]
url, secret = (open(path).read().split('\n') + ['', ''])[:2]
if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]{2,5}/webhooks/[a-z0-9-]+', url) or not secret:
    sys.exit(f'notify: {path} does not hold a webhook URL and secret')
body = json.dumps({'subject': subject, 'message': message[:1900]}).encode()
for attempt in range(4):
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), f'{timestamp}.'.encode() + body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Signature-V2': signature})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            answer = response.read()
        # Hermes also answers 200 when its route drops an alert ("ignored"): only a delivery counts.
        try:
            delivered = json.loads(answer).get('status') == 'delivered'
        except (ValueError, AttributeError):
            delivered = False
        sys.exit(0 if delivered else f'notify: Hermes did not deliver the alert: {answer[:200]!r}')
    except urllib.error.HTTPError as error:
        if error.code < 500:  # refused (signature, guard, route): retrying cannot help
            sys.exit(f'notify: Hermes webhook refused the alert: {error}')
        if attempt == 3:
            sys.exit(f'notify: Hermes webhook failed: {error}')
    except Exception as error:
        if attempt == 3:
            sys.exit(f'notify: Hermes webhook failed: {error}')
    time.sleep(2)
PY
then
	exit 0
fi
webhook=${EMBER_DISCORD_WEBHOOK_FILE:-$HOME/.config/ember/discord-webhook}
if [[ ! -e $webhook ]]; then
	exec hermes send --quiet --to push --subject "$1" "$2"
fi
url=$(head -n 1 -- "$webhook")
[[ $url =~ ^https://[A-Za-z0-9.:-]+/[A-Za-z0-9/_.-]+$ ]] || {
	echo "notify: $webhook does not hold a webhook URL" >&2
	exit 1
}
# Mentions stay off, so an alert can never ping anyone.
jq -n --arg content "$1 $2" '{content: $content[:1900], allowed_mentions: {parse: []}}' |
	curl --fail --silent --show-error --max-time 20 --retry 3 --retry-delay 2 \
		--config <(printf 'url = "%s"\n' "$url") \
		--header 'Content-Type: application/json' --data-binary @- --output /dev/null
