#!/usr/bin/env bash
# Prints true when the browser suites (test:e2e, test:pwa) must run for HEAD, false when every
# file changed since <base> is one the browser build cannot load. Usage: browser-tests-needed.sh
# <base commit or empty>. An empty, unknown or non-ancestor base prints true.
set -Eeuo pipefail
base=${1:-}
if [[ -z $base ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null ||
	! git merge-base --is-ancestor "$base" HEAD; then
	echo true
	exit 0
fi
# Assigned first so a failing diff stops the script instead of reading as no changes.
changed=$(git diff --name-only --no-renames "$base" HEAD)
while IFS= read -r file; do
	[[ -n $file ]] || continue
	case $file in
	# The PWA build imports this, and every browser suite runs through limited.sh.
	server/src/static-files.ts | ops/limited.sh) ;;
	*.md | server/* | ops/* | tests/integration/* | scripts/integration.mjs) continue ;;
	esac
	echo true
	exit 0
done <<<"$changed"
echo false
