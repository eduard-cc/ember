#!/usr/bin/env bash
# Monthly Hermes cron check (script-only, run from the main checkout): do the production npm
# dependencies have high or critical advisories, or does the Node that runs the live app miss
# a security release or the .nvmrc major? If so, put one Ember kanban card on the board; the
# dispatcher picks it up and its worker ships and reports the fix. Prints nothing when there
# is nothing to do or a card for the same findings already exists. Read-only on the
# repository, the live app and the database.
set -Eeuo pipefail
repo=$(dirname -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")")
# ember.service's ExecStart runs this binary.
node_bin=${EMBER_NODE:-$HOME/.local/bin/node}
findings=()

# Dev dependencies only run in CI and builds; what ships is the server's production tree and
# the web bundle built from the root's production dependencies.
for dir in . server; do
	# npm audit exits non-zero whenever it finds anything, so judge it by its JSON.
	json=$(cd -- "$repo/$dir" && npm audit --omit=dev --json 2>/dev/null) || true
	jq -e '.metadata.vulnerabilities' <<<"$json" >/dev/null 2>&1 || {
		echo "npm audit failed in ${dir/#./the app}" >&2
		exit 1
	}
	while IFS= read -r line; do
		findings+=("npm (${dir/#./app}): $line")
	done < <(jq -r '.vulnerabilities[] | select(.severity == "high" or .severity == "critical")
		| "\(.name) has a \(.severity) advisory"' <<<"$json" | sort)
done

want=$(tr -d '[:space:]' <"$repo/.nvmrc")
[[ $want =~ ^[0-9]+$ ]] || {
	echo "unexpected .nvmrc: $want (expected a bare major)" >&2
	exit 1
}
have=$("$node_bin" --version) || {
	echo "cannot run $node_bin" >&2
	exit 1
}
have=${have#v}
[[ ${have%%.*} == "$want" ]] || findings+=("Node: the live app runs $have but .nvmrc (and CI) use $want")
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
	findings+=("Node: the live app runs $have; security release $security is out")
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
- npm: in-major updates only, never \`npm audit fix --force\`. For anything that cannot be fixed safely, record why and whether production can reach it. Re-check the \`overrides\` in package.json and server/package.json and drop any no longer needed.
- Node: ember.service runs $node_bin (resolves to $(readlink -f -- "$node_bin")). Move it to the newest $want.x, restart ember.service and run the live checks. If it resolves outside Ember's own files, other tools share it: change how Ember gets its Node rather than updating the shared one.
EOF
) || {
	echo 'could not create the kanban card' >&2
	exit 1
}
((created >= started)) || exit 0
echo "Ember: monthly dependency check found ${#findings[@]} issue(s); queued a card to update them."
