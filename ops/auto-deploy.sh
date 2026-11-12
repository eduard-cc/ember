#!/usr/bin/env bash
# Deploy the head of origin/main once its CI has passed. ember-auto-deploy.timer runs
# this every five minutes (installed by ops/install.sh).
#
#   ops/auto-deploy.sh
#
# Fast-forwards this checkout first, so ops/deploy.sh runs the newest scripts. A commit
# whose CI or deploy failed, or that ops/rollback.sh rolled back from, is held: it is
# never retried and the owner is alerted once. The next commit on main replaces the
# hold. When GitHub cannot be reached, the next run simply tries again; once that has
# lasted a day, the owner is alerted once, until GitHub is reachable again.
ACTION=auto-deploy
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"

stop() {
	hold "$1"
	log "holding ${1:0:12}: $2" >&2
	notify "$2"
}

# Created by the first run that cannot read GitHub (its mtime is when that began) and
# removed by the next run that can; it holds "alerted" once the owner has been told.
UNREACHABLE=$EMBER_HOME/github-unreachable

github_unreachable() {
	log "$1; trying again next run" >&2
	[[ -e $UNREACHABLE ]] || : >"$UNREACHABLE"
	[[ ! -s $UNREACHABLE ]] && (($(date +%s) - $(stat -c %Y -- "$UNREACHABLE") >= 86400)) || return 0
	echo alerted >"$UNREACHABLE"
	notify 'Auto-deploy has not been able to read GitHub for a day, so new commits on main are not deploying. Details: journalctl --user -u ember-auto-deploy -n 80'
}

# Everything runs from this function, parsed in full before the fast-forward below
# rewrites the scripts on disk.
main() {
	(($# == 0)) || {
		echo "usage: $(basename "$0")" >&2
		exit 2
	}
	local sha ci branch previous rc=0
	# The whole run holds the deploy lock, so no rollback or other deploy can change
	# the hold or the release under it; ops/deploy.sh inherits the lock.
	mkdir -p "$RELEASES"
	exec 9>"$EMBER_HOME/deploy.lock"
	flock -n 9 || {
		log 'another deploy or rollback is running; trying again next run' >&2
		return 0
	}
	"${GIT[@]}" fetch --quiet origin main || {
		github_unreachable 'could not fetch origin/main'
		return 0
	}
	sha=$("${GIT[@]}" rev-parse origin/main)
	if [[ $sha == "$(current_release)" || $sha == "$(held)" ]]; then
		rm -f -- "$UNREACHABLE"
		return 0
	fi
	ci=$(ci_state "$sha") || {
		github_unreachable 'could not read CI results from GitHub'
		return 0
	}
	rm -f -- "$UNREACHABLE"
	case $ci in
	pending)
		log "waiting for CI on ${sha:0:12}"
		return 0
		;;
	failure)
		stop "$sha" "CI failed on main at ${sha:0:12}, so it was not deployed."
		return 0
		;;
	esac
	branch=$("${GIT[@]}" symbolic-ref --quiet --short HEAD || true)
	if [[ $branch != main ]] || ! "${GIT[@]}" merge --quiet --ff-only "$sha"; then
		stop "$sha" "Auto-deploy of ${sha:0:12} stopped: ~/src/ember is not a main checkout that fast-forwards to it."
		return 0
	fi
	# Held while it deploys, so a run killed midway (the unit's timeout) is not retried;
	# systemd's OnFailure alert reports that one.
	previous=$(held)
	hold "$sha"
	log "deploying ${sha:0:12}"
	"$SCRIPT_DIR/deploy.sh" "$sha" || rc=$?
	case $rc in
	0) ;;
	69 | 75)
		if [[ -n $previous ]]; then hold "$previous"; else rm -f -- "$HOLD"; fi
		log 'GitHub unreachable, CI still running or another deploy running; trying again next run' >&2
		;;
	*) stop "$sha" "Auto-deploy of ${sha:0:12} failed, so main is not live. Details: journalctl --user -u ember-auto-deploy -n 80" ;;
	esac
}

main "$@"; exit
