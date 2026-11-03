#!/usr/bin/env bash
# Send one alert to the owner's Discord.
#
#   ops/notify.sh <subject> <message>
#
# The Ember service account has no Hermes login: it posts to a Discord webhook whose URL
# is the only line of ~/.config/ember/discord-webhook (mode 0600). Without that file the
# alert goes through `hermes send`, as on an owner-run install. The URL never appears on
# a command line, where other local users could read it.
set -Eeuo pipefail
(($# == 2)) || {
	echo "usage: $(basename "$0") <subject> <message>" >&2
	exit 2
}
export PATH=$HOME/.local/bin:$PATH
webhook=${EMBER_DISCORD_WEBHOOK_FILE:-$HOME/.config/ember/discord-webhook}
if [[ ! -e $webhook ]]; then
	exec hermes send --quiet --to discord --subject "$1" "$2"
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
