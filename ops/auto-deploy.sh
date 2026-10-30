#!/usr/bin/env bash
# Deploy the head of origin/main once its CI has passed. ember-auto-deploy.timer runs
# this every five minutes (installed by ops/install.sh).
#
#   ops/auto-deploy.sh
#
# Fast-forwards this checkout first, so ops/deploy.sh runs the newest scripts. A commit
# whose CI or deploy failed, or that ops/rollback.sh rolled back from, is held: it is
# never retried and Discord hears about it once. The next commit on main replaces the
# hold. When GitHub cannot be reached, the next run simply tries again.
ACTION=auto-deploy
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"

stop() {
	hold "$1"
	log "holding ${1:0:12}: $2" >&2
	notify "$2"
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
		log 'could not fetch origin/main; trying again next run' >&2
		return 0
	}
	sha=$("${GIT[@]}" rev-parse origin/main)
	[[ $sha != "$(current_release)" && $sha != "$(held)" ]] || return 0
	ci=$(ci_state "$sha") || {
		log 'could not read CI results from GitHub; trying again next run' >&2
		return 0
	}
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
