# shellcheck shell=bash
# Shared by deploy.sh and rollback.sh; not executable on its own.
#
# Layout (GYM_LOG_HOME, default ~/.local/share/gym-log):
#   releases/<sha>/   built web shell (dist/) and server (server/dist, production node_modules)
#   current           symlink to the serving release; gym-log.service and GYM_LOG_WEB_ROOT use it
#   history           healthy deploys, oldest first; rollback pops it like a stack
#   deploy.lock       held by every deploy or rollback
set -Eeuo pipefail
shopt -s inherit_errexit

export PATH=$HOME/.local/bin:$PATH
GYM_LOG_HOME=${GYM_LOG_HOME:-$HOME/.local/share/gym-log}
GYM_LOG_ENV=${GYM_LOG_ENV:-$HOME/.config/gym-log/runtime.env}
GYM_LOG_UNIT=${GYM_LOG_UNIT:-gym-log.service}
RELEASES=$GYM_LOG_HOME/releases
CURRENT=$GYM_LOG_HOME/current
HISTORY=$GYM_LOG_HOME/history

log() { echo "gym-log-${ACTION:-ops}: $*"; }
die() {
	log "ERROR: $*" >&2
	exit 1
}
notify() { hermes send --quiet --to discord --subject '[gym-log]' "$1" || log 'could not send the Discord alert' >&2; }

lock() {
	mkdir -p "$RELEASES"
	exec 9>"$GYM_LOG_HOME/deploy.lock"
	flock -n 9 || {
		log 'another deploy or rollback is running' >&2
		exit 75
	}
}

current_release() { [[ -L $CURRENT ]] && basename -- "$(readlink -- "$CURRENT")" || true; }

# Read one non-secret value from runtime.env without sourcing the secrets in it.
setting() {
	local value
	value=$(sed -nE "s/^$1=//p" "$GYM_LOG_ENV" | tail -n 1)
	value=${value#\"}
	echo "${value%\"}"
}

check_config() {
	[[ -f $GYM_LOG_ENV ]] || die "missing $GYM_LOG_ENV"
	[[ $(setting GYM_LOG_WEB_ROOT) == "$CURRENT/dist" ]] || die "GYM_LOG_WEB_ROOT in $GYM_LOG_ENV must be $CURRENT/dist"
	[[ $(setting GYM_LOG_PORT) =~ ^[0-9]+$ ]] || die "GYM_LOG_PORT missing from $GYM_LOG_ENV"
	[[ -n $(setting GYM_LOG_ORIGIN) ]] || die "GYM_LOG_ORIGIN missing from $GYM_LOG_ENV"
}

# Atomic: a reader always sees either the old or the new release.
point_current() {
	ln -sfn "releases/$1" "$CURRENT.tmp" && mv -T -- "$CURRENT.tmp" "$CURRENT"
}

fetch() { curl --fail --silent --show-error --max-time 10 --retry 10 --retry-delay 2 --retry-all-errors "$@"; }

# The unit's own process owns the port (not a leftover one), the API answers on
# loopback and through Serve, and Serve returns this release's shell. Startup runs
# migrations, so the first answer may take a while.
healthy() {
	local port origin pid deadline=$((SECONDS + ${GYM_LOG_START_TIMEOUT:-120}))
	port=$(setting GYM_LOG_PORT)
	origin=$(setting GYM_LOG_ORIGIN)
	until curl -fsS --max-time 5 --output /dev/null "http://127.0.0.1:$port/api/v1/health" 2>/dev/null; do
		systemctl --user is-active --quiet "$GYM_LOG_UNIT" || {
			log "$GYM_LOG_UNIT is not running" >&2
			return 1
		}
		((SECONDS < deadline)) || {
			log "no healthy answer on port $port" >&2
			return 1
		}
		sleep 2
	done
	pid=$(systemctl --user show --property MainPID --value "$GYM_LOG_UNIT")
	ss -ltnpH "sport = :$port" | grep -q "pid=$pid," || {
		log "port $port is not served by $GYM_LOG_UNIT (pid $pid)" >&2
		return 1
	}
	fetch --output /dev/null "$origin/api/v1/health" || return 1
	fetch "$origin/" | cmp -s - "$CURRENT/dist/index.html" || {
		log 'Tailscale Serve did not return the current release shell' >&2
		return 1
	}
}

restart_and_check() {
	# A crash-looping release can trip the start limit; clear it so a rollback can start.
	systemctl --user reset-failed "$GYM_LOG_UNIT" 2>/dev/null || true
	systemctl --user restart "$GYM_LOG_UNIT" || return 1
	healthy
}

write_history() {
	if (($#)); then printf '%s\n' "$@" | tail -n 50 >"$HISTORY.tmp"; else : >"$HISTORY.tmp"; fi &&
		mv -T -- "$HISTORY.tmp" "$HISTORY"
}

# History is a stack of healthy deploys. Roll back to the newest entry that is
# not the serving release; the stack only changes once that release is healthy.
# Database migrations stay applied; the pre-migration backup is the way back for data.
roll_back() {
	local now target stack=()
	now=$(current_release)
	[[ -f $HISTORY ]] && mapfile -t stack <"$HISTORY"
	while ((${#stack[@]})) && [[ ${stack[-1]} == "$now" || ! -f $RELEASES/${stack[-1]}/.complete ]]; do
		unset 'stack[-1]'
	done
	((${#stack[@]})) || {
		log 'no earlier healthy release to roll back to' >&2
		return 1
	}
	target=${stack[-1]}
	log "rolling back from ${now:-nothing} to $target"
	# Callers test this function, which disables errexit inside it: check each step.
	point_current "$target" || return 1
	restart_and_check || return 1
	write_history "${stack[@]}" || return 1
	log "rolled back to $target (database migrations are not rolled back)"
}
