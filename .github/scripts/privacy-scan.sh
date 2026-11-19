#!/usr/bin/env bash
# Scans what a PR adds for the owner's private denylist: its branch name, commit identities and
# messages, raw commit objects, added diff lines (binary files included, byte for byte) and every
# added, copied or renamed-to path. Usage: privacy-scan.sh <base> <head> [<branch name>], with
# the denylist (one case-insensitive PCRE) in $PRIVACY_DENYLIST, trailing newlines ignored. Prints only a count of distinct matches, never
# the matched text, and fails closed: an empty or broken denylist or a failed listing fails.
# Removed lines and deleted paths are not scanned, so deleting a leak always passes. A merge is
# diffed against each parent, so merging main into a branch shows main's changes as added.
set -euo pipefail
base=$1 head=$2 branch=${3-}
deny=$(printf '%s' "${PRIVACY_DENYLIST-}")
[[ -n ${deny//[[:space:]]/} ]] || {
	echo "privacy: the denylist is empty or unavailable" >&2
	exit 1
}
# grep exits 2 on a pattern it cannot compile, which would otherwise read as "no match".
rc=0
grep -qiP -- "$deny" </dev/null || rc=$?
((rc == 1)) || {
	echo "privacy: the denylist does not compile as PCRE (grep -P exit $rc)" >&2
	exit 1
}

scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT
# Scan the objects as stored: replace refs and grafts would substitute commits or parents.
export GIT_NO_REPLACE_OBJECTS=1 GIT_GRAFT_FILE=$scratch/no-grafts
range=("$base..$head")
scan=$scratch/added
# errexit is off inside an `if` condition, so every step is chained with &&.
if ! {
	printf '%s\n' "$branch" &&
		git log --format='%an <%ae>%n%cn <%ce>%n%B' "${range[@]}" &&
		git rev-list "${range[@]}" | git cat-file --batch &&
		git -c core.quotePath=false log -p --root --text --no-textconv --no-ext-diff --no-relative --no-color \
			--diff-merges=separate --format= "${range[@]}" >"$scratch/diff" &&
		{ grep -a '^+' "$scratch/diff" || (($? == 1)); } &&
		git log -z --root --name-only --diff-filter=d --find-renames --no-relative --diff-merges=separate \
			--format= "${range[@]}" | tr '\0' '\n'
} >"$scan"; then
	echo "privacy: could not list the PR's commits" >&2
	exit 1
fi
rc=0
grep -oaiP -- "$deny" "$scan" >"$scratch/matches" || rc=$?
case $rc in
0)
	echo "privacy: $(sort -u "$scratch/matches" | wc -l) distinct denylisted term(s) in the branch name, added lines, paths or commits" >&2
	exit 1
	;;
1) echo "privacy: no denylisted terms in $(git rev-list --count "${range[@]}") commit(s)" ;;
*)
	echo "privacy: the scan failed (grep exit $rc)" >&2
	exit 1
	;;
esac
