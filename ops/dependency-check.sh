#!/usr/bin/env bash
# Monthly scheduled check (script-only): do the production npm
# dependencies have high or critical advisories, or does the Node the image pins (the
# Dockerfile's base image, which the live app runs) miss a security release or the .nvmrc
# major? If so, put one Ember kanban card on the board.
# Prints nothing when there is nothing to do or a card for the same findings already exists.
# Read-only on the repository, the live app and the database.
set -Eeuo pipefail
# The owner's cron runs a reviewed copy installed outside the checkout, with EMBER_REPO set to
# the owner's checkout, which it only reads: code from main never runs as the owner.
repo=${EMBER_REPO:-$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")}
findings=()

# Dev dependencies only run in CI and builds; what ships is the API's production tree and
# the web bundle built from the web app's production dependencies.
for app in web api; do
	# npm audit exits non-zero whenever it finds anything, so judge it by its JSON.
	json=$(cd -- "$repo/apps/$app" && npm audit --omit=dev --json 2>/dev/null) || true
	jq -e '.metadata.vulnerabilities' <<<"$json" >/dev/null 2>&1 || {
		echo "npm audit failed in apps/$app" >&2
		exit 1
	}
	while IFS= read -r line; do
		findings+=("npm ($app): $line")
	done < <(jq -r '.vulnerabilities[] | select(.severity == "high" or .severity == "critical")
		| "\(.name) has a \(.severity) advisory"' <<<"$json" | sort)
done

want=$(tr -d '[:space:]' <"$repo/.nvmrc")
[[ $want =~ ^[0-9]+$ ]] || {
	echo "unexpected .nvmrc: $want (expected a bare major)" >&2
	exit 1
}
# The same pin ops/image-smoke.sh checks the built image against.
have=$(sed -nE 's/^FROM node:([0-9]+\.[0-9]+\.[0-9]+)-bookworm-slim@sha256:[0-9a-f]{64} AS base$/\1/p' "$repo/Dockerfile")
[[ $have =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
	echo 'no exact Node pin in Dockerfile' >&2
	exit 1
}
[[ ${have%%.*} == "$want" ]] || findings+=("Node: the image pins $have but .nvmrc (and CI) use $want")
index=$(curl -fsS --max-time 20 https://nodejs.org/dist/index.json) || {
	echo 'could not read the Node release index' >&2
	exit 1
}
# Old entries in the index carry pre-release suffixes; only plain x.y.z releases count.
security=$(jq -r --arg have "$have" '
	($have | split(".") | map(tonumber)) as $h
	| [.[] | select(.security and (.version | test("^v[0-9]+\\.[0-9]+\\.[0-9]+$")))
		| .version | ltrimstr("v") | split(".") | map(tonumber)
		| select(.[0] == $h[0] and . > $h)]
	| if length == 0 then empty else max | map(tostring) | join(".") end
	' <<<"$index") || {
	echo 'unexpected Node release index' >&2
	exit 1
}
if [[ -n $security ]]; then
	findings+=("Node: the image pins $have; security release $security is out")
fi

((${#findings[@]})) || exit 0

list=$(printf -- '- %s\n' "${findings[@]}")
started=$(date +%s)
# The same findings give the same key, so a card that is still open (or finished without
# clearing them) is not queued twice; only a card created now is news.
created=$(hermes kanban create "Ember: dependency and Node updates" --json \
	--assignee default --skill ember-operator --workspace "worktree:$repo" \
	--idempotency-key "ember-deps-$(sha256sum <<<"$list" | cut -c1-16)" \
	--body-file - <<EOF | jq -r '.created_at'
Automated monthly check (ops/dependency-check.sh) found:
$list

Fix what applies and ship per AGENTS.md:
- npm: in-major updates only, never \`npm audit fix --force\`. For anything that cannot be fixed safely, record why and whether production can reach it. Re-check the \`overrides\` in apps/web/package.json and apps/api/package.json and drop any no longer needed.
- Node: the live app runs the image's Node, pinned by tag and digest in the Dockerfile's first stage. Move that pin to the newest $want.x (Dependabot's docker update does this; merge it if one is open), then check the deploy and the live app.
EOF
) || {
	echo 'could not create the kanban card' >&2
	exit 1
}
((created >= started)) || exit 0
echo "Ember: monthly dependency check found ${#findings[@]} issue(s); queued a card to update them."
