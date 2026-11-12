#!/usr/bin/env bash
# Build a commit from main into its own release folder and switch the live app to it.
#
#   ops/deploy.sh <commit>
#
# Refuses unless the commit is on origin/main and CI passed for its latest code
# change. Builds from `git archive`, never from a working tree. A release that adds
# a migration is preceded by a backup whose restore is tested. If the new release
# is unhealthy, the previous release is restored and the owner is alerted. Migrations
# are never rolled back.
ACTION=deploy
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"
# shellcheck source=ops/docker-host.sh
source "$SCRIPT_DIR/docker-host.sh"

[[ $# == 1 && $1 =~ ^[0-9a-f]{7,40}$ ]] || {
	echo "usage: $(basename "$0") <commit>" >&2
	exit 2
}
KEEP_RELEASES=5
KEEP_BACKUPS=3
BACKUPS=${EMBER_BACKUPS:-$HOME/.local/share/ember-backups}

lock
check_config

# GitHub unreachable or CI still running exits 69, which ops/auto-deploy.sh retries
# instead of holding.
retry_later() {
	log "ERROR: $*" >&2
	exit 69
}
"${GIT[@]}" fetch --quiet origin main || retry_later 'could not fetch origin/main'
sha=$("${GIT[@]}" rev-parse --verify --quiet "$1^{commit}") || die "unknown commit $1"
"${GIT[@]}" merge-base --is-ancestor "$sha" origin/main || die "$sha is not on main"

ci=$(ci_state "$sha") || retry_later 'could not read CI results from GitHub'
[[ $ci != pending ]] || retry_later "CI is still running for ${sha:0:12}"
[[ $ci == success ]] || die "CI failed for ${sha:0:12}"

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
			NODE_ENV=development npm --prefix apps/web ci --include=dev --no-audit --no-fund --loglevel=error &&
			NODE_ENV=development npm --prefix apps/api ci --include=dev --no-audit --no-fund --loglevel=error &&
			# Vite derives import.meta.env.PROD from NODE_ENV.
			NODE_ENV=production npm --prefix apps/web run build &&
			NODE_ENV=production npm --prefix apps/api run build &&
			npm --prefix apps/api prune --omit=dev --no-audit --no-fund --loglevel=error &&
			[[ -f apps/web/dist/index.html && -f apps/api/dist/trial.js ]] &&
			# Keep only what runs, in the release layout ember.service and EMBER_WEB_ROOT expect:
			# the web shell in dist/ and the compiled server with its runtime dependencies in server/.
			mv -T apps/web/dist dist &&
			mkdir server &&
			mv -t server apps/api/dist apps/api/node_modules apps/api/package.json
	) >"$build.log" 2>&1 || {
		tail -n 40 -- "$build.log" >&2
		rm -f -- "$build.log"
		die 'build failed; nothing was deployed'
	}
	rm -f -- "$build.log"
	find "$build" -mindepth 1 -maxdepth 1 ! -name dist ! -name server -exec rm -rf -- {} +
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
applied=$(docker exec ember-postgres sh -c \
	'exec psql -U "$POSTGRES_USER" -d ember -v ON_ERROR_STOP=1 -Atc "SELECT name FROM migrations"') ||
	die 'could not read applied migrations from ember'
unknown=$(comm -13 <(sort <<<"$release_migrations") <(sort <<<"$applied"))
[[ -z $unknown ]] || die "the database has migrations this release lacks ($(tr '\n' ' ' <<<"$unknown")); refusing to run old code on a newer schema"
pending=$(comm -23 <(sort <<<"$release_migrations") <(sort <<<"$applied"))
if [[ -n $pending ]]; then
	log "release adds migrations: $(tr '\n' ' ' <<<"$pending")"
	[[ -d $BACKUPS ]] || mkdir -m 700 -- "$BACKUPS"
	backup=$BACKUPS/ember-$(date +%Y%m%dT%H%M%S)-pre-deploy-${sha:0:12}.dump
	"$SCRIPT_DIR/backup.sh" ember "$backup" || die 'pre-migration backup failed; nothing was deployed'
	validation=ember_restore_validation_$(date +%s)
	"$SCRIPT_DIR/restore-check.sh" "$backup" "$validation" ||
		die "restore check of $backup failed; nothing was deployed"
	# restore-check.sh leaves its validation copy for the caller; compare, then drop it.
	count='SELECT (SELECT count(*) FROM public.records) || chr(32) || (SELECT count(*) FROM public.migrations)'
	live=$(docker exec ember-postgres sh -c 'exec psql -U "$POSTGRES_USER" -d ember -Atc "$1"' sh "$count") || live=
	restored=$(docker exec ember-postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$1" -Atc "$2"' sh "$validation" "$count") ||
		restored=
	docker exec ember-postgres sh -c 'exec dropdb -U "$POSTGRES_USER" "$1"' sh "$validation" ||
		log "could not drop $validation; drop it by hand" >&2
	[[ -n $live && $live == "$restored" ]] ||
		die "restored copy differs from ember (records/migrations $restored vs $live); nothing was deployed"
	log "restore-tested backup kept at $backup"
	# Only pre-deploy backups rotate; manual archives are never touched.
	find "$BACKUPS" -maxdepth 1 -name 'ember-*-pre-deploy-*.dump' -printf '%f\n' | sort | head -n -"$KEEP_BACKUPS" |
		while read -r old; do rm -f -- "${BACKUPS:?}/$old"; done
fi

rc=0
switch_release "$sha" || rc=$?
case $rc in
0) ;;
1) die 'deploy failed; rolled back to the previous release' ;;
2) die 'ROLLBACK FAILED; the app is unhealthy and needs attention' ;;
3) die 'could not switch releases; nothing was deployed' ;;
*) die "unexpected switch result $rc" ;;
esac

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
