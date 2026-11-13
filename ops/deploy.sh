#!/usr/bin/env bash
# Put a commit from main into its own release folder and switch the live app to it.
#
#   ops/deploy.sh <commit>
#   ops/deploy.sh --host-build <commit>
#
# Refuses unless the commit is on origin/main and CI passed for its latest code change.
# The release is the image CI tested and published for that code: pulled by the digest its
# green run recorded and checked against the image's own labels; no tag is ever resolved
# here. --host-build instead builds the commit on this host from `git archive`, never from
# a working tree (a manual fallback while the registry is unavailable). A release that adds
# a migration, or the first image release after a host-built one, is preceded by a backup
# whose restore is tested. If the new release is unhealthy, the previous release is
# restored and the owner is alerted. Migrations are never rolled back.
ACTION=deploy
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"

host_build=false
if [[ $# == 2 && $1 == --host-build ]]; then
	host_build=true
	shift
fi
[[ $# == 1 && $1 =~ ^[0-9a-f]{7,40}$ ]] || {
	echo "usage: $(basename "$0") [--host-build] <commit>" >&2
	exit 2
}
KEEP_RELEASES=5
KEEP_BACKUPS=3
BACKUPS=${EMBER_BACKUPS:-$HOME/.local/share/ember-backups}

lock
check_config

# GitHub or the registry unreachable, or CI still running, exits 69, which
# ops/auto-deploy.sh retries instead of holding.
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

# The image a green push run of this code published, as "<image by digest> <commit>", from
# the run's ember-image artifact. The newest green run that published an image counts, and its
# record must name that run's own commit. Runs in a command substitution: exit codes pass through.
image_record() {
	local runs head status conclusion run artifact published record line
	runs=$(ci_runs "$sha") || retry_later 'could not read CI results from GitHub'
	while read -r head status conclusion run; do
		[[ $status == completed && $conclusion == success && $run =~ ^[0-9]+$ ]] || continue
		artifact=$(gh api "repos/$REPO/actions/runs/$run/artifacts?per_page=100" \
			--jq '.artifacts[] | select(.name == "ember-image" and (.expired | not)) | .id') ||
			retry_later "could not read the artifacts of CI run $run"
		artifact=$(sort -n <<<"$artifact" | tail -n 1)
		if [[ -z $artifact ]]; then
			# A run that published nothing (docs only) defers to the next older run; one that
			# published an image whose record is gone (expired, deleted) is refused.
			published=$(gh api "repos/$REPO/actions/runs/$run/jobs?per_page=100" \
				--jq '.jobs[] | select(.name == "Publish image") | .conclusion') ||
				retry_later "could not read the jobs of CI run $run"
			[[ $published != success ]] || die "CI run $run published an image but its ember-image record is gone; refusing"
			continue
		fi
		[[ $artifact =~ ^[0-9]+$ ]] || die "CI run $run lists an unexpected artifact id"
		record=$(mktemp "$RELEASES/.image-record.XXXXXX")
		gh api "repos/$REPO/actions/artifacts/$artifact/zip" >"$record.zip" ||
			retry_later "could not download the image record of CI run $run"
		# At most one short line; anything else is refused below.
		unzip -p "$record.zip" ember-image 2>/dev/null | head -c 200 >"$record" || true
		line=$(<"$record") 2>/dev/null
		# Byte for byte, so no NUL or other byte the substitution drops can pass.
		if ! [[ $line =~ ^(ghcr\.io/eduard-cc/ember@sha256:[0-9a-f]{64})\ ([0-9a-f]{40})$ ]] ||
			! cmp -s -- "$record" <(printf '%s\n' "$line"); then
			die "the image record of CI run $run is not one image by digest and its commit; refusing"
		fi
		rm -f -- "$record" "$record.zip"
		[[ ${BASH_REMATCH[2]} == "$head" ]] ||
			die "the image record of CI run $run names commit ${BASH_REMATCH[2]:0:12}, not the run's ${head:0:12}; refusing"
		echo "${BASH_REMATCH[1]} $head"
		return 0
	done <<<"$runs"
	die "no green CI run of ${sha:0:12}'s code recorded an image; refusing"
}

# Pulls an image by digest, then checks that its own labels name this repository and the
# commit. A failed pull is retried later only when the registry itself cannot be reached or
# answers 429 or 5xx, judged by asking it, never by the error text; anything else (an image
# it does not have, a full disk) fails the deploy.
fetch_image() {
	local image=$1 commit=$2 pulled labels status
	log "pulling $image, the CI image of ${commit:0:12}"
	pulled=$(docker pull --quiet "$image" 2>&1) || {
		status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 15 "https://${image%%/*}/v2/") ||
			status=000
		if [[ $status == 000 || $status == 429 || $status == 5?? ]]; then
			retry_later "could not reach the registry for $image (HTTP $status; $(tail -n 1 <<<"$pulled"))"
		fi
		die "could not pull $image ($(tail -n 1 <<<"$pulled"))"
	}
	labels=$(docker image inspect --format \
		'{{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "org.opencontainers.image.source"}}' \
		"$image") || die "could not inspect $image"
	[[ $labels == "$commit $IMAGE_SOURCE" ]] ||
		die "$image is labelled '$labels', not commit ${commit:0:12} of $IMAGE_SOURCE; refusing"
}

# Leftovers of interrupted builds; the lock guarantees no build is running.
find "$RELEASES" -mindepth 1 -maxdepth 1 \( -name '.build-*' -o -name '.image-record.*' \) -exec rm -rf -- {} +
release=$RELEASES/$sha
previous=$(current_release)
# What this deploy makes: a host-built release for --host-build, otherwise an image release
# naming exactly the image the newest green run of this code recorded. A complete release of
# that kind (a roll-forward after a rollback, or the live one) is reused; its image is pulled
# again by the same digest if it has left the daemon.
reuse=false
if [[ $host_build == true ]]; then
	[[ -f $release/.complete ]] && ! is_image_release "$release" && reuse=true
else
	record=$(image_record)
	image=${record% *} commit=${record#* }
	if [[ -f $release/.complete && $(release_image "$release" || true) == "$image" ]]; then
		reuse=true
		docker image inspect "$image" >/dev/null 2>&1 || fetch_image "$image" "$commit"
	fi
fi
if [[ $previous == "$sha" ]]; then
	[[ $reuse == true ]] || die "the live release of ${sha:0:12} is not the one this deploy would make; refusing to replace it"
	healthy || die "$sha is already current but unhealthy; run ops/rollback.sh"
	log "$sha is already live and healthy"
	exit 0
fi
# A release rollback can return to is never replaced, so a failed replacement cannot lose it.
if [[ $reuse != true && -e $release ]] && grep -qx -- "$sha" "$HISTORY" 2>/dev/null; then
	die "releases/$sha is a different release that ops/rollback.sh can return to; refusing to replace it"
fi

if [[ $reuse == true ]]; then
	log "reusing the release of $sha"
elif [[ $host_build == true ]]; then
	log "building $sha on this host"
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
	# Only a release no rollback can return to is replaced (checked above).
	rm -rf -- "$release"
	mv -T -- "$build" "$release"
	trap - EXIT
else
	fetch_image "$image" "$commit"
	build=$(mktemp -d "$RELEASES/.build-$sha.XXXXXX")
	container=
	trap 'rm -rf -- "$build"; [[ -z $container ]] || docker rm "$container" >/dev/null 2>&1 || true' EXIT
	# The web shell is copied out of the image the unit runs, so the health check and the
	# live check compare what Serve returns with exactly what the container serves.
	container=$(docker create --network none "$image") || die "could not create a container of $image"
	docker cp --quiet "$container:/app/web" "$build/dist" || die "could not copy the web shell out of $image"
	docker rm "$container" >/dev/null
	container=
	[[ -f $build/dist/index.html && -f $build/dist/sw.js ]] || die "$image has no web shell in /app/web"
	echo "$image" >"$build/IMAGE"
	echo "$sha" >"$build/REVISION"
	touch "$build/.complete"
	# Only a release no rollback can return to is replaced (checked above).
	rm -rf -- "$release"
	mv -T -- "$build" "$release"
	trap - EXIT
fi
# ember.service starts an image release through the installed launcher, which deploys
# never update: refuse before anything changes if it is missing or older than this checkout.
if is_image_release "$release"; then
	if ! cmp -s -- "$SCRIPT_DIR/start.sh" "$HOME/.local/lib/ember/start.sh" ||
		! systemctl --user show --property ExecStart --value "$EMBER_UNIT" |
		grep -qF "path=$HOME/.local/lib/ember/start.sh "; then
		die "$EMBER_UNIT does not start releases through this checkout's ops/start.sh; run ops/install.sh, then deploy again"
	fi
fi

# Migrations the live database has not applied yet, by TypeORM migration name.
release_migrations=$(release_node "$release" -e '
	const {database} = require("./dist/db/database");
	for (const m of database("postgres://unused@127.0.0.1/unused").options.migrations) console.log(m.name);
' </dev/null) || die 'could not list the release migrations'
applied=$(docker exec ember-postgres sh -c \
	'exec psql -U "$POSTGRES_USER" -d ember -v ON_ERROR_STOP=1 -Atc "SELECT name FROM migrations"') ||
	die 'could not read applied migrations from ember'
unknown=$(comm -13 <(sort <<<"$release_migrations") <(sort <<<"$applied"))
[[ -z $unknown ]] || die "the database has migrations this release lacks ($(tr '\n' ' ' <<<"$unknown")); refusing to run old code on a newer schema"
pending=$(comm -23 <(sort <<<"$release_migrations") <(sort <<<"$applied"))

# The switch from a host-built release to an image release changes how the app reaches
# the database, so it takes the same backup gate as a migration.
gate=
if [[ -n $pending ]]; then
	gate="release adds migrations: $(tr '\n' ' ' <<<"$pending")"
elif is_image_release "$release" && ! { [[ -n $previous ]] && is_image_release "$RELEASES/$previous"; }; then
	gate="first image release after the host-built ${previous:-nothing}"
fi
if [[ -n $gate ]]; then
	log "$gate"
	[[ -d $BACKUPS ]] || mkdir -m 700 -- "$BACKUPS"
	backup=$BACKUPS/ember-$(date +%Y%m%dT%H%M%S)-pre-deploy-${sha:0:12}.dump
	"$SCRIPT_DIR/backup.sh" ember "$backup" || die 'pre-deploy backup failed; nothing was deployed'
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
	log "restore-tested backup kept at $backup (records/migrations $live in both)"
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

# Keep the newest releases from the deploy history, always including the live one, and the
# images they name. Any other image of this repository in Ember's daemon (a removed release's,
# or one a refused deploy pulled) is removed, by its digest only; nothing is ever pruned.
mapfile -t keep < <(tac -- "$HISTORY" | awk '!seen[$0]++' | head -n "$KEEP_RELEASES")
for dir in "$RELEASES"/*/; do
	name=$(basename -- "$dir")
	[[ $name == "$sha" ]] || printf '%s\n' "${keep[@]}" | grep -qx -- "$name" || rm -rf -- "${RELEASES:?}/$name"
done
kept_images=$(for dir in "$RELEASES"/*/; do release_image "$dir" || true; done)
# Images pulled by digest have no tag, which plain `image ls` hides.
images=$(docker image ls --all --digests --format '{{.Repository}}@{{.Digest}}' ghcr.io/eduard-cc/ember) || {
	log "could not list the images in Ember's Docker daemon; old images stay" >&2
	exit 0
}
while read -r image; do
	if [[ $image =~ $IMAGE_PATTERN ]] && ! grep -qxF -- "$image" <<<"$kept_images"; then
		docker image rm "$image" >/dev/null || log "could not remove $image; remove it by hand" >&2
	fi
done <<<"$images"
