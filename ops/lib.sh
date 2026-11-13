# shellcheck shell=bash
# Shared by deploy.sh and rollback.sh; not executable on its own.
#
# Layout (EMBER_HOME, default ~/.local/share/ember):
#   releases/<sha>/   a release, one of two kinds:
#                     image: IMAGE (the image by digest) and dist/, the web shell copied out of it
#                     host-built: dist/ and server/ (server/dist, production node_modules)
#   current           symlink to the serving release; ember.service and EMBER_WEB_ROOT use it
#   history           healthy deploys, oldest first; rollback pops it like a stack
#   deploy.lock       held by every deploy or rollback
#   auto-deploy.hold  a main commit ops/auto-deploy.sh must not deploy
set -Eeuo pipefail
shopt -s inherit_errexit
# Byte-wise matching: the image and digest patterns below must only ever match ASCII.
export LC_ALL=C

export PATH=$HOME/.local/bin:$PATH
EMBER_HOME=${EMBER_HOME:-$HOME/.local/share/ember}
EMBER_ENV=${EMBER_ENV:-$HOME/.config/ember/runtime.env}
EMBER_UNIT=${EMBER_UNIT:-ember.service}
# The unit whose rootlesskit publishes container ports on loopback.
EMBER_DOCKER_UNIT=${EMBER_DOCKER_UNIT:-ember-docker.service}
RELEASES=$EMBER_HOME/releases
CURRENT=$EMBER_HOME/current
HISTORY=$EMBER_HOME/history
HOLD=$EMBER_HOME/auto-deploy.hold
REPO=${EMBER_GITHUB_REPO:-eduard-cc/ember}
GIT=(git -C "$SCRIPT_DIR/..")
# The only image a release may name, always by digest; ops/start.sh checks the same pattern.
IMAGE_PATTERN='^ghcr\.io/eduard-cc/ember@sha256:[0-9a-f]{64}$'
# shellcheck disable=SC2034 # used by ops/deploy.sh
IMAGE_SOURCE=https://github.com/eduard-cc/ember
# The container ember.service runs for an image release (ops/start.sh).
APP_CONTAINER=ember-app
# shellcheck source=ops/docker-host.sh
source "$SCRIPT_DIR/docker-host.sh"

log() { echo "ember-${ACTION:-ops}: $*"; }
die() {
	log "ERROR: $*" >&2
	exit 1
}
notify() { "$SCRIPT_DIR/notify.sh" '[ember]' "$1" || log 'could not send the alert' >&2; }

# ops/auto-deploy.sh takes the lock and runs ops/deploy.sh with it on fd 9, which this
# reuses: flock on the same open file succeeds, and reopening would release it.
lock() {
	mkdir -p "$RELEASES"
	[[ $(readlink -- /proc/self/fd/9 2>/dev/null) == "$(readlink -f -- "$EMBER_HOME/deploy.lock")" ]] ||
		exec 9>"$EMBER_HOME/deploy.lock"
	flock -n 9 || {
		log 'another deploy or rollback is running' >&2
		exit 75
	}
}

current_release() { if [[ -L $CURRENT ]]; then basename -- "$(readlink -- "$CURRENT")"; fi; }

# An image release has an IMAGE entry, whatever it is; a host-built release has none.
is_image_release() { [[ -e $1/IMAGE || -L $1/IMAGE ]]; }

# The image a release folder names, when it is an image release: IMAGE holds exactly one
# line, the image by digest. Fails for a host-built release and for anything malformed.
release_image() {
	local file=$1/IMAGE image
	[[ -f $file && ! -L $file ]] || return 1
	image=$(<"$file")
	[[ $image =~ $IMAGE_PATTERN && $(stat -c %s -- "$file") == $((${#image} + 1)) ]] || return 1
	echo "$image"
}

# Push runs of CI for a commit on main, newest first, as "<head sha> <status> <conclusion>
# <run id>". A push runs CI only for its head commit, and a docs-only run tests no code, so
# any commit from the newest code change up to $1 has the same code and may carry the run.
# Fails when GitHub cannot be read.
ci_runs() {
	local code_sha same_code runs
	code_sha=$("${GIT[@]}" log -1 --format=%H "$1" -- . ':(exclude,glob)**/*.md') || return 1
	same_code=$({ echo "$code_sha"; "${GIT[@]}" rev-list "$code_sha..$1"; }) || return 1
	runs=$(gh run list -R "$REPO" --workflow CI --event push --branch main --limit 100 \
		--json headSha,status,conclusion,databaseId \
		--jq '.[] | "\(.headSha) \(.status) \(.conclusion) \(.databaseId)"') || return 1
	awk 'NR == FNR { same[$1]; next } $1 in same' <(echo "$same_code") <(echo "$runs")
}

# CI result for a commit on main: success, pending or failure. A cancelled run is not
# green; a commit with no run yet is pending. Fails when GitHub cannot be read.
ci_state() {
	local runs
	runs=$(ci_runs "$1") || return 1
	if awk '$3 == "success" { found = 1 } END { exit !found }' <<<"$runs"; then
		echo success
	elif [[ -z $runs ]] || awk '$2 != "completed" { found = 1 } END { exit !found }' <<<"$runs"; then
		echo pending
	else
		echo failure
	fi
}

held() { cat -- "$HOLD" 2>/dev/null || true; }
hold() { echo "$1" >"$HOLD.tmp" && mv -T -- "$HOLD.tmp" "$HOLD"; }
# After a manual rollback main stays off until a newer commit lands, however many
# rollbacks follow. The checkout's origin/main is at most one timer run old.
hold_main() {
	local head
	head=$("${GIT[@]}" rev-parse --verify --quiet origin/main) || head=$(current_release)
	[[ -z $head ]] || hold "$head"
}

# Read one non-secret value from runtime.env without sourcing the secrets in it.
setting() {
	local value
	value=$(sed -nE "s/^$1=//p" "$EMBER_ENV" | tail -n 1)
	value=${value#\"}
	echo "${value%\"}"
}

check_config() {
	[[ -f $EMBER_ENV ]] || die "missing $EMBER_ENV"
	[[ $(setting EMBER_WEB_ROOT) == "$CURRENT/dist" ]] || die "EMBER_WEB_ROOT in $EMBER_ENV must be $CURRENT/dist"
	[[ $(setting EMBER_PORT) =~ ^[0-9]+$ ]] || die "EMBER_PORT missing from $EMBER_ENV"
	[[ -n $(setting EMBER_ORIGIN) ]] || die "EMBER_ORIGIN missing from $EMBER_ENV"
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
# a 404); switch_release puts it in the alert.
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
	# The URLS line is written by apps/web/scripts/pwa-build.ts.
	mapfile -t urls < <(release_node "$CURRENT" -e '
		const match = /^const URLS = (\[.*\]);$/m.exec(require("node:fs").readFileSync(0, "utf8"));
		if (!match) throw new Error("no URLS list");
		const urls = JSON.parse(match[1]);
		if (!urls.length) throw new Error("empty URLS list");
		for (const url of new Set(["/sw.js", "/manifest.webmanifest", ...urls])) console.log(url);
	' <"$dist/sw.js" 2>/dev/null || echo ERROR)
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

# Runs the Node of a release with the given arguments and stdin: the image's own Node, with
# no network or capabilities, for an image release; the account's Node in server/ otherwise.
release_node() {
	local release=$1 image
	shift
	if image=$(release_image "$release"); then
		docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
			--entrypoint node "$image" "$@"
	elif is_image_release "$release"; then
		log "$release/IMAGE does not name the image by digest" >&2
		return 1
	else
		(cd "$release/server" && node "$@")
	fi
}

# The process listening on the port is the serving release's, not a leftover one: for a
# host-built release the unit's own process; for an image release the container
# ember.service started from exactly that image, published on loopback only by the
# daemon's rootlesskit.
owns_port() {
	local port=$1 image want got pid pids
	if ! is_image_release "$CURRENT"; then
		pid=$(systemctl --user show --property MainPID --value "$EMBER_UNIT")
		ss -ltnpH "sport = :$port" | grep -q "pid=$pid," || {
			log "port $port is not served by $EMBER_UNIT (pid $pid)" >&2
			return 1
		}
		return 0
	fi
	image=$(release_image "$CURRENT") || {
		log "$CURRENT/IMAGE does not name the image by digest" >&2
		return 1
	}
	want=$(docker image inspect --format '{{.Id}}' "$image") || {
		log "$image is not in Ember's Docker daemon" >&2
		return 1
	}
	got=$(docker inspect --format \
		"{{.State.Running}} {{.Image}} {{range (index .NetworkSettings.Ports \"$port/tcp\")}}{{.HostIp}}:{{.HostPort}} {{end}}" \
		"$APP_CONTAINER" 2>/dev/null) || got=
	[[ $got == "true $want 127.0.0.1:$port " ]] || {
		log "$APP_CONTAINER is not running $image on 127.0.0.1:$port only" >&2
		return 1
	}
	mapfile -t pids < <(ss -ltnpH "sport = :$port" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
	((${#pids[@]})) || {
		log "nothing listens on port $port" >&2
		return 1
	}
	for pid in "${pids[@]}"; do
		[[ $(cat "/proc/$pid/comm" 2>/dev/null) == rootlesskit &&
			$(cat "/proc/$pid/cgroup" 2>/dev/null) == */"$EMBER_DOCKER_UNIT" ]] || {
			log "port $port is not published by $EMBER_DOCKER_UNIT (pid $pid)" >&2
			return 1
		}
	done
}

# The serving release owns the port (owns_port), the API answers on loopback and through
# Serve, and Serve returns this release's shell and every file its service worker
# precaches. Startup runs migrations, so the first answer may take a while.
healthy() {
	local port origin deadline=$((SECONDS + ${EMBER_START_TIMEOUT:-120}))
	HEALTH_DETAIL=
	port=$(setting EMBER_PORT)
	origin=$(setting EMBER_ORIGIN)
	until curl -fsS --max-time 5 --output /dev/null "http://127.0.0.1:$port/api/v1/health" 2>/dev/null; do
		systemctl --user is-active --quiet "$EMBER_UNIT" || {
			log "$EMBER_UNIT is not running" >&2
			return 1
		}
		((SECONDS < deadline)) || {
			log "no healthy answer on port $port" >&2
			return 1
		}
		sleep 2
	done
	owns_port "$port" || return 1
	fetch --output /dev/null "$origin/api/v1/health" || return 1
	fetch "$origin/" | cmp -s - "$CURRENT/dist/index.html" || {
		log 'Tailscale Serve did not return the current release shell' >&2
		return 1
	}
	shell_served "$origin"
}

restart_and_check() {
	# A crash-looping release can trip the start limit; clear it so a rollback can start.
	systemctl --user reset-failed "$EMBER_UNIT" 2>/dev/null || true
	systemctl --user restart "$EMBER_UNIT" || return 1
	healthy
}

# Switch to a built release and check it. A failed check rolls back and sends an alert.
# Returns 0 when live and healthy, 1 after a successful rollback, 2 when the rollback
# failed too, and 3 when the link could not be switched (nothing changed).
switch_release() {
	local sha=$1 problem now
	now=$(current_release)
	log "switching ${now:-nothing} -> $sha"
	# Callers test this function, which disables errexit inside it: check each step.
	point_current "$sha" || {
		log 'could not switch the current link; nothing changed' >&2
		return 3
	}
	restart_and_check && return 0
	problem="Deploy of ${sha:0:12} failed its health check${HEALTH_DETAIL:+ ($HEALTH_DETAIL)}"
	log "$problem; rolling back" >&2
	if ! roll_back; then
		notify "$problem and the ROLLBACK FAILED. Ember needs attention: journalctl --user -u $EMBER_UNIT -n 50"
		return 2
	fi
	notify "$problem, so it was rolled back to $(current_release). Migrations are not rolled back. Details: journalctl --user -u $EMBER_UNIT -n 50"
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
