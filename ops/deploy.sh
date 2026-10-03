#!/usr/bin/env bash
# Build a commit from main into its own release folder and switch the live app to it.
#
#   ops/deploy.sh <commit>
#
# Refuses unless the commit is on origin/main and CI passed for its latest code
# change. Builds from `git archive`, never from a working tree. A release that adds
# a migration is preceded by a backup whose restore is tested. If the new release
# is unhealthy, the previous one is restored and Discord is told. Migrations are
# never rolled back.
ACTION=deploy
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"

[[ $# == 1 && $1 =~ ^[0-9a-f]{7,40}$ ]] || {
	echo "usage: $(basename "$0") <commit>" >&2
	exit 2
}
KEEP_RELEASES=5
KEEP_BACKUPS=3
BACKUPS=${GYM_LOG_BACKUPS:-$HOME/.local/share/gym-log-backups}
REPO=${GYM_LOG_GITHUB_REPO:-eduard-cc/gym-log}
GIT=(git -C "$SCRIPT_DIR/..")

lock
check_config

"${GIT[@]}" fetch --quiet origin main || die 'could not fetch origin/main'
sha=$("${GIT[@]}" rev-parse --verify --quiet "$1^{commit}") || die "unknown commit $1"
"${GIT[@]}" merge-base --is-ancestor "$sha" origin/main || die "$sha is not on main"

# Docs-only commits skip CI and a push runs CI only for its head commit, so any
# commit from the newest code change up to $sha has the same code and may carry
# the run. A cancelled or still-running run is not green.
code_sha=$("${GIT[@]}" log -1 --format=%H "$sha" -- . ':(exclude,glob)**/*.md' ':(exclude).hermes') ||
	die 'could not find the latest code commit'
same_code=$({ echo "$code_sha"; "${GIT[@]}" rev-list "$code_sha..$sha"; }) || die 'could not list commits'
green=$(gh run list -R "$REPO" --workflow CI --event push --branch main --limit 100 \
	--json headSha,conclusion --jq '.[] | select(.conclusion == "success") | .headSha') ||
	die 'could not read CI results from GitHub'
grep -qxFf <(echo "$same_code") <<<"$green" || die "CI has not passed for ${code_sha:0:12} or a docs-only commit after it"

previous=$(current_release)
if [[ $previous == "$sha" ]]; then
	healthy || die "$sha is already current but unhealthy; run ops/rollback.sh"
	log "$sha is already live and healthy"
	exit 0
fi

release=$RELEASES/$sha
# Leftovers of interrupted builds; the lock guarantees no build is running.
find "$RELEASES" -mindepth 1 -maxdepth 1 -name '.build-*' -exec rm -rf -- {} +
if [[ ! -f $release/.complete ]]; then
	log "building $sha"
	rm -rf -- "$release"
	build=$(mktemp -d "$RELEASES/.build-$sha.XXXXXX")
	trap 'rm -rf -- "$build"' EXIT
	"${GIT[@]}" archive --format=tar "$sha" | tar -x -C "$build"
	# Chained with &&: errexit is off on the left of ||, so every step must gate the next.
	(
		cd "$build" &&
			# Shells may export NODE_ENV=production, which makes npm ci skip the build tools.
			NODE_ENV=development npm ci --include=dev --no-audit --no-fund --loglevel=error &&
			NODE_ENV=development npm --prefix server ci --include=dev --no-audit --no-fund --loglevel=error &&
			# Vite derives import.meta.env.PROD from NODE_ENV.
			NODE_ENV=production npm run build &&
			NODE_ENV=production npm --prefix server run build &&
			npm --prefix server prune --omit=dev --no-audit --no-fund --loglevel=error &&
			[[ -f dist/index.html && -f server/dist/trial.js ]]
	) >"$build.log" 2>&1 || {
		tail -n 40 -- "$build.log" >&2
		rm -f -- "$build.log"
		die 'build failed; nothing was deployed'
	}
	rm -f -- "$build.log"
	# Keep only what runs: the web shell and the compiled server with its runtime dependencies.
	find "$build" -mindepth 1 -maxdepth 1 ! -name dist ! -name server -exec rm -rf -- {} +
	find "$build/server" -mindepth 1 -maxdepth 1 ! -name dist ! -name node_modules ! -name package.json \
		-exec rm -rf -- {} +
	echo "$sha" >"$build/REVISION"
	touch "$build/.complete"
	mv -T -- "$build" "$release"
	trap - EXIT
fi

# Migrations the live database has not applied yet, by TypeORM migration name.
release_migrations=$(cd "$release/server" && node -e '
	const {database} = require("./dist/db/database");
	for (const m of database("postgres://unused@127.0.0.1/unused").options.migrations) console.log(m.name);
') || die 'could not list the release migrations'
applied=$(docker exec gym-log-local-postgres sh -c \
	'exec psql -U "$POSTGRES_USER" -d gym_log -v ON_ERROR_STOP=1 -Atc "SELECT name FROM migrations"') ||
	die 'could not read applied migrations from gym_log'
unknown=$(comm -13 <(sort <<<"$release_migrations") <(sort <<<"$applied"))
[[ -z $unknown ]] || die "the database has migrations this release lacks ($(tr '\n' ' ' <<<"$unknown")); refusing to run old code on a newer schema"
pending=$(comm -23 <(sort <<<"$release_migrations") <(sort <<<"$applied"))
if [[ -n $pending ]]; then
	log "release adds migrations: $(tr '\n' ' ' <<<"$pending")"
	[[ -d $BACKUPS ]] || mkdir -m 700 -- "$BACKUPS"
	backup=$BACKUPS/gym_log-$(date +%Y%m%dT%H%M%S)-pre-deploy-${sha:0:12}.dump
	"$SCRIPT_DIR/backup.sh" gym_log "$backup" || die 'pre-migration backup failed; nothing was deployed'
	validation=gym_log_restore_validation_$(date +%s)
	"$SCRIPT_DIR/restore-check.sh" "$backup" "$validation" ||
		die "restore check of $backup failed; nothing was deployed"
	# restore-check.sh leaves its validation copy for the caller; compare, then drop it.
	count='SELECT (SELECT count(*) FROM public.records) || chr(32) || (SELECT count(*) FROM public.migrations)'
	live=$(docker exec gym-log-local-postgres sh -c 'exec psql -U "$POSTGRES_USER" -d gym_log -Atc "$1"' sh "$count") || live=
	restored=$(docker exec gym-log-local-postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$1" -Atc "$2"' sh "$validation" "$count") ||
		restored=
	docker exec gym-log-local-postgres sh -c 'exec dropdb -U "$POSTGRES_USER" "$1"' sh "$validation" ||
		log "could not drop $validation; drop it by hand" >&2
	[[ -n $live && $live == "$restored" ]] ||
		die "restored copy differs from gym_log (records/migrations $restored vs $live); nothing was deployed"
	log "restore-tested backup kept at $backup"
	# Only pre-deploy backups rotate; manual archives are never touched.
	find "$BACKUPS" -maxdepth 1 -name 'gym_log-*-pre-deploy-*.dump' -printf '%f\n' | sort | head -n -"$KEEP_BACKUPS" |
		while read -r old; do rm -f -- "${BACKUPS:?}/$old"; done
fi

log "switching ${previous:-nothing} -> $sha"
point_current "$sha"
if ! restart_and_check; then
	log "$sha is unhealthy; rolling back" >&2
	if roll_back; then
		notify "Deploy of ${sha:0:12} failed its health check and was rolled back to $(current_release). Migrations are not rolled back. Details: journalctl --user -u $GYM_LOG_UNIT -n 50"
		die 'deploy failed; rolled back to the previous release'
	fi
	notify "Deploy of ${sha:0:12} failed and the ROLLBACK FAILED. Gym Log needs attention: journalctl --user -u $GYM_LOG_UNIT -n 50"
	die 'ROLLBACK FAILED; the app is unhealthy and needs attention'
fi

history=()
[[ -f $HISTORY ]] && mapfile -t history <"$HISTORY"
write_history "${history[@]}" "$sha"
log "deployed $sha and healthy"

# Keep the newest releases from the deploy history, always including the live one.
mapfile -t keep < <(tac -- "$HISTORY" | awk '!seen[$0]++' | head -n "$KEEP_RELEASES")
for dir in "$RELEASES"/*/; do
	name=$(basename -- "$dir")
	[[ $name == "$sha" ]] && continue
	printf '%s\n' "${keep[@]}" | grep -qx -- "$name" || rm -rf -- "${RELEASES:?}/$name"
done
