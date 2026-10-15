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
	# A malformed value would make the extra endpoints look down on every deploy, which silently
	# switches the guard off.
	local url urls
	read -ra urls <<<"$(extra_urls)"
	((${#urls[@]})) || die "GYM_LOG_EXTRA_HEALTH_URLS in $GYM_LOG_ENV is empty"
	for url in "${urls[@]}"; do
		[[ $url =~ ^(https?|file)://[^[:space:]\'\"#]+$ ]] || die "invalid extra health URL '$url' in GYM_LOG_EXTRA_HEALTH_URLS"
	done
}

# Atomic: a reader always sees either the old or the new release.
point_current() {
	ln -sfn "releases/$1" "$CURRENT.tmp" && mv -T -- "$CURRENT.tmp" "$CURRENT"
}

fetch() { curl --fail --silent --show-error --max-time 10 --retry 10 --retry-delay 2 --retry-all-errors "$@"; }

# Without --retry-all-errors curl retries only timeouts, refused connections and
# 408/429/500/502/503/504, so a missing file fails at once instead of stalling the deploy.
fetch_file() { curl --fail --silent --show-error --max-time 10 --retry 3 --retry-delay 1 --retry-connrefused "$@"; }

# Why the last health check failed, when the server's journal will not say (it never logs
# a 404); switch_release puts it in the Discord alert.
HEALTH_DETAIL=
unhealthy() {
	HEALTH_DETAIL=$1
	log "$1" >&2
	return 1
}

# The service worker's install fails on a single missing file, which leaves installed apps
# on the old shell while the API looks healthy. So Serve must return the worker, the
# manifest and every file the worker precaches byte for byte from this release.
shell_served() {
	local origin=$1 dist=$CURRENT/dist url urls=()
	[[ -f $dist/sw.js ]] || {
		unhealthy 'this release has no dist/sw.js'
		return
	}
	# The URLS line is written by scripts/pwa-build.ts.
	mapfile -t urls < <(node -e '
		const match = /^const URLS = (\[.*\]);$/m.exec(require("node:fs").readFileSync(process.argv[1], "utf8"));
		if (!match) throw new Error("no URLS list");
		const urls = JSON.parse(match[1]);
		if (!urls.length) throw new Error("empty URLS list");
		for (const url of new Set(["/sw.js", "/manifest.webmanifest", ...urls])) console.log(url);
	' "$dist/sw.js" 2>/dev/null || echo ERROR)
	[[ ${#urls[@]} -gt 2 && ${urls[-1]} != ERROR ]] || {
		unhealthy 'could not read the precache list from dist/sw.js'
		return
	}
	for url in "${urls[@]}"; do
		# A path outside dist/ would compare the wrong file; the server never serves one anyway.
		[[ $url =~ ^/[A-Za-z0-9_][A-Za-z0-9_./-]*$ && $url != *..* ]] || {
			unhealthy "dist/sw.js precaches an unexpected path: $url"
			return
		}
		fetch_file "$origin$url" | cmp -s - "$dist$url" || {
			unhealthy "Serve did not return $url"
			return
		}
	done
}

# The unit's own process owns the port (not a leftover one), the API answers on
# loopback and through Serve, and Serve returns this release's shell and every file its
# service worker precaches. Startup runs migrations, so the first answer may take a while.
healthy() {
	local port origin pid deadline=$((SECONDS + ${GYM_LOG_START_TIMEOUT:-120}))
	HEALTH_DETAIL=
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
	shell_served "$origin"
}

restart_and_check() {
	# A crash-looping release can trip the start limit; clear it so a rollback can start.
	systemctl --user reset-failed "$GYM_LOG_UNIT" 2>/dev/null || true
	systemctl --user restart "$GYM_LOG_UNIT" || return 1
	healthy
}

# Read-only probes of the extra health endpoints bracket every gym switch.
# runtime.env lists them, space-separated, in
# GYM_LOG_EXTRA_HEALTH_URLS; the environment variable overrides it for tests.
extra_urls() {
	local urls=${GYM_LOG_EXTRA_HEALTH_URLS:-$(setting GYM_LOG_EXTRA_HEALTH_URLS)}
	echo "${urls:-http://127.0.0.1:<port>/api/health}"
}

extra_healthy() {
	local url urls type
	read -ra urls <<<"$(extra_urls)"
	((${#urls[@]})) || return 1
	for url in "${urls[@]}"; do
		type=$(curl -fsS --max-time 10 --output /dev/null --write-out '%{content_type}' "$url" 2>/dev/null) || return 1
		# A health endpoint answers JSON. An HTML page means the URL fell through to a web
		# app's shell, which would make a dead API look healthy.
		[[ $type != text/html* ]] || return 1
	done
}

# An extra endpoint may restart on its own, so give it time to come back before
# blaming the gym switch.
extra_recovered() {
	local deadline=$((SECONDS + ${GYM_LOG_EXTRA_GRACE:-90}))
	until extra_healthy; do
		((SECONDS < deadline)) || return 1
		sleep 5
	done
}

# Switch to a built release and check it. If the extra endpoints were healthy before
# ($2 == true), also check that they still are. A failed check rolls back and alerts Discord.
# Returns 0 when live and healthy, 1 after a successful rollback, 2 when the rollback
# failed too, 3 when the link could not be switched (nothing changed), and 4 when only
# an extra endpoint failed but the release applied migrations ($3 == true): rolling back would run
# old code on a newer schema, so it stays live and Discord is told instead.
switch_release() {
	local sha=$1 extra_before=$2 migrated=${3:-false} problem extra_after= now
	now=$(current_release)
	log "switching ${now:-nothing} -> $sha"
	# Callers test this function, which disables errexit inside it: check each step.
	point_current "$sha" || {
		log 'could not switch the current link; nothing changed' >&2
		return 3
	}
	if ! restart_and_check; then
		problem="Deploy of ${sha:0:12} failed its health check${HEALTH_DETAIL:+ ($HEALTH_DETAIL)}"
	elif [[ $extra_before == true ]] && ! extra_recovered; then
		# Correlation, not proof: an endpoint may also restart on its own.
		problem="The extra health endpoints stopped responding after Gym Log deployed ${sha:0:12}"
		if [[ $migrated == true ]]; then
			notify "$problem. Gym Log was NOT rolled back because this release applied database migrations the previous one does not know. Check them first; roll Gym Log back by hand only if it is the cause."
			return 4
		fi
	else
		return 0
	fi
	log "$problem; rolling back" >&2
	if ! roll_back; then
		notify "$problem and the ROLLBACK FAILED. Gym Log needs attention: journalctl --user -u $GYM_LOG_UNIT -n 50"
		return 2
	fi
	if [[ $extra_before == true ]]; then
		if extra_recovered; then extra_after=' The extra endpoints are healthy again.'; else extra_after=' The extra endpoints are STILL unhealthy and need attention.'; fi
	fi
	notify "$problem, so it was rolled back to $(current_release).$extra_after Migrations are not rolled back. Details: journalctl --user -u $GYM_LOG_UNIT -n 50"
	return 1
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
