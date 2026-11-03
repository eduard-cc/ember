#!/usr/bin/env bash
# Monthly Hermes cron check (script-only): has a newer PostgreSQL
# minor of the pinned major been released? If so, put one Ember kanban card on the board to
# bump it; the dispatcher picks it up and its worker ships and reports the change. Prints
# nothing when there is nothing to do or the card already exists. Read-only on the
# repository, the container and the database.
set -Eeuo pipefail
# The owner's cron runs a reviewed copy installed outside the checkout, with EMBER_REPO set to
# the owner's checkout, which it only reads: code from main never runs as the owner.
repo=${EMBER_REPO:-$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")}
pin=$(grep -oE 'postgres:[0-9]+\.[0-9]+-bookworm' "$repo/ops/compose.local.yml" | head -n 1)
[[ $pin =~ ^postgres:([0-9]+)\.([0-9]+)-bookworm$ ]] || {
	echo "unexpected pin in compose.local.yml: ${pin:-none}" >&2
	exit 1
}
major=${BASH_REMATCH[1]} minor=${BASH_REMATCH[2]}

# Succeeds when the tag exists, fails when Docker Hub says 404, exits on anything else.
tag() {
	local code
	code=$(curl -sS --max-time 20 --output /dev/null --write-out '%{http_code}' \
		"https://hub.docker.com/v2/repositories/library/postgres/tags/$1") || code=000
	case $code in
	200) return 0 ;;
	404) return 1 ;;
	*)
		echo "Docker Hub answered $code for postgres:$1" >&2
		exit 1
		;;
	esac
}
tag "$major.$minor-bookworm" || {
	echo "Docker Hub no longer lists the pinned $pin" >&2
	exit 1
}
latest=$minor
while tag "$major.$((latest + 1))"; do
	# A release without a bookworm build means the image moved to a newer Debian: that needs
	# a deliberate decision, not a check that goes quiet.
	tag "$major.$((latest + 1))-bookworm" || {
		echo "postgres:$major.$((latest + 1)) has no bookworm tag; Ember's image pin needs a decision" >&2
		exit 1
	}
	latest=$((latest + 1))
done
((latest > minor)) || exit 0

started=$(date +%s)
# The idempotency key returns the existing card on later runs, so only a card created now
# is news.
created=$(hermes kanban create "Ember: bump PostgreSQL to $major.$latest" --json \
	--assignee default --skill ember-operator --workspace "worktree:$repo" \
	--idempotency-key "ember-postgres-$major.$latest" \
	--body "Automated monthly check: postgres:$major.$latest-bookworm is out; Ember pins $major.$minor. Read the release notes from $major.$((minor + 1)) on for post-update steps, bump every pin (tests/postgres-image.test.ts lists them) and ship per AGENTS.md. Roll out: back up with the old scripts and restore-check it, recreate ember-postgres with ops/docker.sh compose -f ops/compose.local.yml up -d --wait right after the push, then rerun ops/backup.sh and ops/restore-check.sh on the new image. Keep the container name, database and daemon socket." |
	jq -r '.created_at') || {
	echo 'could not create the kanban card' >&2
	exit 1
}
((created >= started)) || exit 0
echo "Ember: PostgreSQL $major.$latest is out (running $major.$minor); queued a card to update it."
