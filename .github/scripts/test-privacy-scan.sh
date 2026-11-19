#!/usr/bin/env bash
# privacy-scan.sh against a throwaway repository with a synthetic denylist.
set -euo pipefail
scan=$(cd "$(dirname "$0")" && pwd)/privacy-scan.sh
repo=$(mktemp -d)
trap 'rm -rf -- "$repo"' EXIT
cd "$repo"
git init -q -b main
git config user.name Synthetic && git config user.email owner@example.test
echo 'synthetic-term in a file the base already has' >old.txt
git add -A && git commit -qm base
base=$(git rev-parse HEAD)
export PRIVACY_DENYLIST='synthetic-term|fake-(?=marker)'
fails=0

# expect <exit code> <description> [<branch name>]: runs the scan of base..HEAD, checks its exit
# code and that its output never shows a matched term.
expect() {
	local rc=0 out
	out=$(bash "$scan" "$base" HEAD "${3-}" 2>&1) || rc=$?
	if ((rc != $1)) || grep -qiE 'synthetic-term|fake-marker' <<<"$out"; then
		echo "FAIL: $2 (exit $rc): $out"
		fails=1
	else
		echo "ok: $2"
	fi
}
branch() {
	git checkout -q -B "$1" "$base"
}

branch clean
echo 'nothing private' >new.txt && git add -A && git commit -qm 'add a clean file'
expect 0 'a clean change passes'
sed -i 's/synthetic-term/removed/' old.txt && git commit -qam 'remove the term from a line'
expect 0 'removing a term passes'

branch text
printf 'one Synthetic-Term\ntwo fake-marker\nthree Synthetic-Term\n' >new.txt && git add -A && git commit -qm 'add terms'
out=$(bash "$scan" "$base" HEAD 2>&1) || true
if [[ $out == *'2 distinct'* ]]; then
	echo 'ok: added lines report the distinct count'
else
	echo "FAIL: added lines report the distinct count: $out"
	fails=1
fi
expect 1 'an added line fails without printing the term'

branch binary
printf 'PNG\0\0synthetic-term\0' >image.png && git add -A && git commit -qm 'add an image'
expect 1 'a term inside a binary file fails'

branch path
echo clean >synthetic-term.txt && git add -A && git commit -qm 'add a file'
expect 1 'a term in a new path fails'

branch message
echo clean >new.txt && git add -A && git commit -qm 'mention synthetic-term'
expect 1 'a term in a commit message fails'
out=$(PRIVACY_DENYLIST=$'synthetic-term\n' bash "$scan" "$base" HEAD 2>&1) || true
if [[ $out == *'1 distinct'* ]]; then
	echo 'ok: a denylist with a trailing newline still matches'
else
	echo "FAIL: a denylist with a trailing newline still matches: $out"
	fails=1
fi

branch merged
echo clean >new.txt && git add -A && git commit -qm 'clean'
git checkout -q -b side "$base" && echo 'synthetic-term' >side.txt && git add -A && git commit -qm 'side'
git checkout -q merged && git merge -q --no-edit side
expect 1 'a term brought in by a merge fails'

branch clean
expect 1 'a term in the branch name fails' 'topic/synthetic-term'
PRIVACY_DENYLIST=' ' expect 1 'an empty denylist fails'
PRIVACY_DENYLIST='(' expect 1 'a denylist that does not compile fails'
exit $fails
