#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of ops/browser-tests-needed.sh against a synthetic git history.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
gate=$SCRIPT_DIR/browser-tests-needed.sh
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-browser-gate-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
fail() {
	echo "browser gate test failed: $*" >&2
	exit 1
}
cd "$sandbox"
git init -q -b main
git config user.email ci@example.invalid
git config user.name ci
commit() {
	mkdir -p "$(dirname -- "$1")"
	echo "$RANDOM" >>"$1"
	git add -A
	git commit -qm "$1"
	git rev-parse HEAD
}
expect() {
	local got
	got=$("$gate" "$1")
	[[ $got == "$2" ]] || fail "$3: expected $2, got $got"
}

base=$(commit src/app.ts)
commit server/src/routes.ts >/dev/null
commit ops/deploy.sh >/dev/null
commit tests/integration/sync.test.ts >/dev/null
commit docs/deploy.md >/dev/null
commit scripts/integration.mjs >/dev/null
expect "$base" false 'server, ops, integration test and docs changes'
expect "$(git rev-parse HEAD)" false 'a rerun of an already passed commit'

commit src/app.ts >/dev/null
expect "$base" true 'a web change among skippable ones'
behind=$(git rev-parse HEAD)
expect "$(git rev-parse HEAD~1)" true 'a web change since the base'

for relevant in server/src/static-files.ts ops/limited.sh tests/e2e/a.spec.ts package-lock.json .github/workflows/ci.yml; do
	start=$(git rev-parse HEAD)
	commit "$relevant" >/dev/null
	expect "$start" true "$relevant"
done

start=$(git rev-parse HEAD)
git mv -- src/app.ts server/src/app.ts
git commit -qm move
expect "$start" true 'a file moved out of the web app'

expect '' true 'no known base'
expect 0000000000000000000000000000000000000000 true 'an unknown base'
git checkout -q -b side "$behind"
side=$(commit server/src/x.ts)
git checkout -q main
expect "$side" true 'a base that is not an ancestor'
echo 'browser gate test passed'
