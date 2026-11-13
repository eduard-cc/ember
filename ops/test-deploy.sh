#!/usr/bin/env bash
# shellcheck disable=SC2015,SC2016 # every fail() exits; the stubs expand their own arguments
# Local check of ops/deploy.sh and ops/rollback.sh for image releases, against a throwaway
# git origin, a fake `gh` that serves CI runs and their image records, a fake `docker`
# with a synthetic registry and database, and stub backup scripts. The unit restart and
# health check are replaced by a stub (ops/test-release-switch.sh covers them); the switch,
# rollback stack, gates and image retention are the real ones. Never touches the live app,
# a Docker daemon, a database or GitHub.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-deploy-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
fail() {
	echo "deploy check failed: $*" >&2
	[[ ! -s $sandbox/out ]] || sed 's/^/  | /' "$sandbox/out" >&2
	exit 1
}

export HOME=$sandbox/home EMBER_HOME=$sandbox/home/ember EMBER_ENV=$sandbox/runtime.env
export EMBER_BACKUPS=$sandbox/backups
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
mkdir -p "$HOME/.local/lib/ember" "$EMBER_HOME/releases" "$sandbox/bin" "$sandbox/registry" \
	"$sandbox/local" "$sandbox/artifacts" "$sandbox/unhealthy"
printf 'EMBER_PORT="5191"\nEMBER_ORIGIN="https://ember.example.invalid"\nEMBER_WEB_ROOT="%s"\n' \
	"$EMBER_HOME/current/dist" >"$EMBER_ENV"
runs=$sandbox/runs log=$sandbox/log alerts=$sandbox/alerts
touch "$runs" "$log" "$alerts"
printf 'Initial1\n' >"$sandbox/applied"
echo '12 1' >"$sandbox/counts"

# gh: the CI runs (already in the --jq output format), each run's artifacts, and the zip
# of an artifact. gh-down makes every call fail, artifacts-down only the artifact list.
cat >"$sandbox/bin/gh" <<EOF
#!/usr/bin/env bash
[[ ! -e $sandbox/gh-down ]] || exit 1
if [[ \$1 == run ]]; then cat -- "$runs"; exit; fi
[[ \$1 == api ]] || exit 1
case \$2 in
*/actions/runs/*/artifacts*)
	[[ ! -e $sandbox/artifacts-down ]] || exit 1
	run=\${2#*/actions/runs/}
	cat -- "$sandbox/artifacts/\${run%%/*}" 2>/dev/null || true
	;;
*/actions/runs/*/jobs*)
	run=\${2#*/actions/runs/}
	echo "\$(cat -- "$sandbox/artifacts/\${run%%/*}.publish" 2>/dev/null || echo skipped)"
	;;
*/actions/artifacts/*/zip)
	artifact=\${2#*/actions/artifacts/}
	cat -- "$sandbox/artifacts/\${artifact%/zip}.zip"
	;;
*) exit 1 ;;
esac
EOF

# docker: a registry of synthetic images ($sandbox/registry/<digest>/: labels, web/,
# migrations), the images pulled into the daemon ($sandbox/local/<digest>) and the
# database, all recorded in the log.
cat >"$sandbox/bin/docker" <<EOF
#!/usr/bin/env bash
set -u
digest() { echo "\${1#*@sha256:}"; }
command=\$1
shift
case \$command in
pull)
	d=\$(digest "\${@: -1}")
	echo "pull \$d" >>"$log"
	[[ ! -e $sandbox/pull-error ]] || { cat -- "$sandbox/pull-error" >&2; exit 1; }
	[[ ! -e $sandbox/pull-error-once ]] || { cat -- "$sandbox/pull-error-once" >&2 && rm -- "$sandbox/pull-error-once"; exit 1; }
	[[ -d $sandbox/registry/\$d ]] || { echo "manifest unknown" >&2; exit 1; }
	touch "$sandbox/local/\$d"
	echo "\${@: -1}"
	;;
image)
	sub=\$1
	shift
	if [[ \$sub == ls ]]; then
		for f in "$sandbox/local"/*; do [[ ! -e \$f ]] || echo "ghcr.io/eduard-cc/ember@sha256:\${f##*/}"; done
		exit
	fi
	d=\$(digest "\${@: -1}")
	[[ -e $sandbox/local/\$d ]] || { echo "No such image" >&2; exit 1; }
	case \$sub in
	inspect)
		if [[ \$* == *revision* ]]; then cat -- "$sandbox/registry/\$d/labels"; else echo "sha256:id-\$d"; fi
		;;
	rm)
		echo "image rm \$d" >>"$log"
		rm -f -- "$sandbox/local/\$d"
		;;
	esac
	;;
create)
	d=\$(digest "\${@: -1}")
	[[ -e $sandbox/local/\$d ]] || exit 1
	echo "container-\$d"
	;;
cp)
	[[ \$1 == --quiet ]] && shift
	d=\${1%%:*}
	d=\${d#container-}
	cp -r -- "$sandbox/registry/\$d/web" "\$2"
	;;
rm) ;;
version) cat -- "$sandbox/daemon-arch" 2>/dev/null || echo amd64 ;;
run)
	# Only the release's migration list runs a container here.
	for ((i = 1; i <= \$#; i++)); do
		[[ \${!i} != *@sha256:* ]] || d=\$(digest "\${!i}")
	done
	[[ -e $sandbox/local/\$d ]] || exit 125
	cat -- "$sandbox/registry/\$d/migrations"
	;;
exec)
	# exec ember-postgres sh -c <script> sh [args...]
	script=\$4
	shift 5
	case \$script in
	*'SELECT name FROM migrations'*) cat -- "$sandbox/applied" ;;
	*dropdb*) echo "dropdb \$1" >>"$log" ;;
	*'-d ember '*) cat -- "$sandbox/counts" ;;
	*) cat -- "$sandbox/restored-counts" 2>/dev/null || cat -- "$sandbox/counts" ;;
	esac
	;;
*) exit 1 ;;
esac
EOF
# systemctl only answers what starts ember.service: the installed launcher.
cat >"$sandbox/bin/systemctl" <<EOF
#!/usr/bin/env bash
echo "{ path=$HOME/.local/lib/ember/start.sh ; argv[]=$HOME/.local/lib/ember/start.sh ... }"
EOF
# curl: the registry's side of a pull. /v2/ answers 401 and a token request a pull token;
# a manifest or blob by digest answers that token from $sandbox/manifests or $sandbox/blobs,
# 404 when absent. registry-status overrides every answer, registry-status-<kind> (token,
# manifest, blob) one kind's and registry-status-<digest> one part's: a status, "down" (no
# connection), "cut" (a 200 whose body breaks off) or "local" (a 200 curl cannot write out).
# Writes what deploy.sh's --write-out '\n%{http_code}' asks for, or the status alone.
cat >"$sandbox/bin/curl" <<EOF
#!/usr/bin/env bash
out=/dev/stdout config= accept= format='%{http_code}'
while ((\$#)); do
	case \$1 in
	--output) out=\$2 && shift ;;
	--write-out) format=\$2 && shift ;;
	--config) config=\$(cat) && shift ;;
	-H) [[ \$2 != Accept:* ]] || accept=\$2 && shift ;;
	--max-time | --range) shift ;;
	-*) ;;
	*) url=\$1 ;;
	esac
	shift
done
digest=\${url##*/sha256:}
case \$url in
*/v2/) kind=root status=401 body= ;;
*/token\?*) kind=token status=200 body='{"token":"synthetic"}' ;;
*/manifests/sha256:*)
	kind=manifest status=404 body='{"errors":[{"code":"MANIFEST_UNKNOWN"}]}'
	[[ ! -e $sandbox/manifests/\$digest || \$accept != *manifest.v2+json* ]] ||
		{ status=200 && body=\$(<"$sandbox/manifests/\$digest"); }
	;;
*/blobs/sha256:*) kind=blob status=404 body= && [[ ! -e $sandbox/blobs/\$digest ]] || status=206 body=x ;;
*) exit 6 ;;
esac
[[ \$kind == root || \$kind == token || \$config == 'header = "Authorization: Bearer synthetic"' ]] ||
	status=401 body=
for f in "registry-status-\$digest" "registry-status-\$kind" registry-status; do
	[[ ! -e $sandbox/\$f ]] || { status=\$(<"$sandbox/\$f") && break; }
done
answer() { printf '%s' "\$1" >"\$out" && printf "\${format//'%{http_code}'/\$2}"; }
case \$status in
down) answer '' 000 && exit 7 ;;
cut) answer "\${body:0:2}" 200 && exit 18 ;;
local) printf "\${format//'%{http_code}'/200}" && exit 23 ;;
*) answer "\$body" "\$status" ;;
esac
EOF
# npm makes the files a host build keeps; the account's Node lists its migrations.
cat >"$sandbox/bin/npm" <<'EOF'
#!/usr/bin/env bash
app=$2
case $3 in
ci) mkdir -p "$app/node_modules" && touch "$app/package.json" ;;
run) mkdir -p "$app/dist" && touch "$app/dist/index.html" "$app/dist/trial.js" ;;
esac
EOF
mkdir -p "$HOME/.local/bin"
printf '#!/usr/bin/env bash\nprintf "Initial1\\nSecond2\\n"\n' >"$HOME/.local/bin/node"
chmod +x "$sandbox/bin"/* "$HOME/.local/bin/node"
export PATH=$sandbox/bin:$PATH

git init --quiet --bare --initial-branch=main "$sandbox/origin.git"
git clone --quiet "$sandbox/origin.git" "$sandbox/upstream" 2>/dev/null
commit() {
	echo "$RANDOM" >>"$sandbox/upstream/$1"
	git -C "$sandbox/upstream" add -A
	git -C "$sandbox/upstream" commit --quiet -m "change $1"
	git -C "$sandbox/upstream" push --quiet origin HEAD:main
	git -C "$sandbox/upstream" rev-parse HEAD
}
c0=$(commit app.txt)
git clone --quiet "$sandbox/origin.git" "$sandbox/checkout"
ops=$sandbox/checkout/ops
mkdir -p "$ops"
cp -- "$SCRIPT_DIR"/{deploy.sh,rollback.sh,docker-host.sh,start.sh} "$ops/"
# The real lib.sh, with the restart and health check stubbed: a release is unhealthy when
# $sandbox/unhealthy/<sha> exists.
{
	cat -- "$SCRIPT_DIR/lib.sh"
	cat <<EOF
restart_and_check() {
	echo "restart \$(current_release)" >>"$log"
	healthy
}
healthy() { [[ ! -e $sandbox/unhealthy/\$(current_release) ]]; }
EOF
} >"$ops/lib.sh"
printf '#!/usr/bin/env bash\necho "$2" >>%q\n' "$alerts" >"$ops/notify.sh"
# backup.sh writes a synthetic dump; restore-check.sh records what it restored where.
printf '#!/usr/bin/env bash\n[[ $1 == ember ]] && echo synthetic >"$2" && echo "backup $2" >>%q\n' "$log" >"$ops/backup.sh"
printf '#!/usr/bin/env bash\necho "restore-check $1 $2" >>%q\n' "$log" >"$ops/restore-check.sh"
chmod +x "$ops"/*.sh

# The live state before the first image release: one host-built release.
mkdir -p "$EMBER_HOME/releases/$c0/dist" "$EMBER_HOME/releases/$c0/server/dist"
touch "$EMBER_HOME/releases/$c0/.complete"
ln -s "releases/$c0" "$EMBER_HOME/current"
echo "$c0" >"$EMBER_HOME/history"

# An image CI published for a commit: digest, labels, web shell and migrations.
image() { # <commit> [migrations...]; prints the image by digest (another one with SALT set)
	local sha=$1 d
	shift
	d=$(sha256sum <<<"image $sha ${SALT:-}" | cut -c1-64)
	mkdir -p "$sandbox/registry/$d/web"
	echo "$sha https://github.com/eduard-cc/ember" >"$sandbox/registry/$d/labels"
	echo "<!doctype html><title>$sha</title>" >"$sandbox/registry/$d/web/index.html"
	echo "const URLS = [];" >"$sandbox/registry/$d/web/sw.js"
	printf '%s\n' Initial1 "$@" >"$sandbox/registry/$d/migrations"
	registry_manifest "$d"
	echo "ghcr.io/eduard-cc/ember@sha256:$d"
}
# What the registry serves for an image: its manifest, a config and two layers. With INDEX
# set, the digest names an index of an arm64 image and the image of the daemon's amd64.
registry_manifest() { # <digest>
	local d=$1 m blobs=() b
	mkdir -p "$sandbox/manifests" "$sandbox/blobs"
	for b in config layer1 layer2; do blobs+=("$(sha256sum <<<"$b $d" | cut -c1-64)"); done
	touch "${blobs[@]/#/$sandbox/blobs/}"
	m='{"schemaVersion":2,"mediaType":"application/vnd.docker.distribution.manifest.v2+json",'
	m+="\"config\":{\"digest\":\"sha256:${blobs[0]}\"},"
	m+="\"layers\":[{\"digest\":\"sha256:${blobs[1]}\"},{\"digest\":\"sha256:${blobs[2]}\"}]}"
	if [[ -z ${INDEX:-} ]]; then
		echo "$m" >"$sandbox/manifests/$d"
		return
	fi
	local amd64 arm64
	amd64=$(sha256sum <<<"amd64 $d" | cut -c1-64) arm64=$(sha256sum <<<"arm64 $d" | cut -c1-64)
	echo "$m" >"$sandbox/manifests/$amd64"
	echo '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json"}' >"$sandbox/manifests/$arm64"
	printf '%s' '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[' \
		"{\"digest\":\"sha256:$arm64\",\"platform\":{\"architecture\":\"arm64\",\"os\":\"linux\"}}," \
		"{\"digest\":\"sha256:$amd64\",\"platform\":{\"architecture\":\"amd64\",\"os\":\"linux\"}}]}" \
		>"$sandbox/manifests/$d"
}
next_run=100
# A green push run of <commit> whose ember-image artifact holds <record> (printf format,
# so a test can write a malformed one); no record means no artifact.
green_run() { # <commit> [record]
	next_run=$((next_run + 1))
	# gh lists the newest run first.
	{ echo "$1 completed success $next_run" && cat -- "$runs"; } >"$runs.new" && mv -- "$runs.new" "$runs"
	(($# > 1)) || return 0
	echo success >"$sandbox/artifacts/$next_run.publish"
	echo "$((next_run * 10))" >"$sandbox/artifacts/$next_run"
	python3 -c 'import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z: z.writestr("ember-image", sys.argv[2].encode().decode("unicode_escape"))' \
		"$sandbox/artifacts/$((next_run * 10)).zip" "$2"
}
deploy() { # [--host-build] <commit>; prints the exit code
	local rc=0
	"$ops/deploy.sh" "$@" >"$sandbox/out" 2>&1 || rc=$?
	echo "$rc"
}
live() { [[ $(readlink -- "$EMBER_HOME/current") == "releases/$1" ]]; }
said() { grep -qF -- "$1" "$sandbox/out" || fail "expected output: $1"; }
logged() { grep -qF -- "$1" "$log"; }

c1=$(commit app.txt)
i1=$(image "$c1")

# CI not finished, red, or GitHub unreachable: nothing is fetched or deployed.
[[ $(deploy "$c1") == 69 ]] && said 'CI is still running' || fail 'no run yet must retry later'
echo "$c1 completed failure 99" >"$runs"
[[ $(deploy "$c1") == 1 ]] && said 'CI failed' || fail 'red CI must refuse'
: >"$runs"
touch "$sandbox/gh-down"
[[ $(deploy "$c1") == 69 ]] || fail 'unreachable GitHub must retry later'
rm -- "$sandbox/gh-down"

# A green run that published nothing refuses; one whose published record is gone refuses
# even when an older run of the same code has one; unreadable artifacts retry.
green_run "$c1"
[[ $(deploy "$c1") == 1 ]] && said 'recorded an image; refusing' || fail 'a run without an image must refuse'
: >"$runs"
green_run "$c1" "$i1 $c1\n"
green_run "$c1" "$i1 $c1\n"
rm -- "$sandbox/artifacts/$next_run"
[[ $(deploy "$c1") == 1 ]] && said "CI run $next_run published an image but its ember-image record is gone" ||
	fail 'a newest run whose record is gone must refuse'
: >"$runs"
green_run "$c1" "$i1 $c1\n"
touch "$sandbox/artifacts-down"
[[ $(deploy "$c1") == 69 ]] && said 'could not read the artifacts' || fail 'unreadable artifacts must retry later'
rm -- "$sandbox/artifacts-down"

# Records that are not exactly one image by digest and the run's commit are refused.
for record in "ghcr.io/eduard-cc/ember:main $c1\n" "${i1/eduard-cc/someone} $c1\n" "$i1 $c1\n$i1 $c1\n" \
	"$i1 $c1" "$i1 $c1\0" "$i1 $c1\0\n" "$i1  $c1\n" "${i1}0 $c1\n"; do
	: >"$runs"
	green_run "$c1" "$record"
	[[ $(deploy "$c1") == 1 ]] && said 'is not one image by digest and its commit' ||
		fail "a malformed record must refuse: $record"
done
: >"$runs"
green_run "$c1" "$i1 $c0\n"
[[ $(deploy "$c1") == 1 ]] && said "names commit ${c0:0:12}, not the run's" || fail 'a record of another commit must refuse'
[[ ! -s $log ]] || fail "nothing may be pulled for a refused record: $(<"$log")"

# The registry: an image it does not have is final, an unreachable one retries later,
# and a pulled image must carry this repository's labels for exactly this commit.
: >"$runs"
i_missing=ghcr.io/eduard-cc/ember@sha256:$(sha256sum <<<missing | cut -c1-64)
green_run "$c1" "$i_missing $c1\n"
[[ $(deploy "$c1") == 1 ]] && said 'could not pull' || fail 'a missing image must refuse'
: >"$runs"
green_run "$c1" "$i1 $c1\n"
# A failed pull is judged by what the registry answers along the pull's own path, never by
# the message: no answer, 429 or 5xx for the token, the manifest or a blob retries later,
# even while /v2/ answers normally.
echo 'pull failed' >"$sandbox/pull-error"
for status in down 503 429; do
	echo "$status" >"$sandbox/registry-status"
	[[ $(deploy "$c1") == 69 ]] && said 'could not reach the registry' || fail "an unavailable registry ($status) must retry later"
done
rm -- "$sandbox/registry-status"
: >"$runs"
i_index=$(INDEX=1 SALT=index image "$c1")
green_run "$c1" "$i_index $c1\n"
for kind in token manifest blob; do
	for status in 503 502 429 408 down cut; do
		echo "$status" >"$sandbox/registry-status-$kind"
		[[ $(deploy "$c1") == 69 ]] && said 'could not reach the registry' ||
			fail "an unavailable $kind ($status) must retry later"
		rm -- "$sandbox/registry-status-$kind"
	done
done
# The image's own parts: the manifest of this platform and its last layer.
amd64=$(sha256sum <<<"amd64 ${i_index#*@sha256:}" | cut -c1-64)
layer2=$(sha256sum <<<"layer2 ${i_index#*@sha256:}" | cut -c1-64)
for part in "$amd64" "$layer2"; do
	echo 503 >"$sandbox/registry-status-$part"
	[[ $(deploy "$c1") == 69 ]] && said 'could not reach the registry' || fail "an unavailable part ($part) must retry later"
	echo 404 >"$sandbox/registry-status-$part"
	[[ $(deploy "$c1") == 1 ]] && said "could not pull $i_index (HTTP 404" || fail "a missing part ($part) must fail the deploy"
	rm -- "$sandbox/registry-status-$part"
done
# The registry's definite answer that the image is missing or not ours to pull is final, and
# so is a curl failure on this host.
for refusal in manifest:404 blob:404 token:403 manifest:401 blob:403 token:local blob:local; do
	echo "${refusal#*:}" >"$sandbox/registry-status-${refusal%:*}"
	[[ $(deploy "$c1") == 1 ]] && said "could not pull $i_index" || fail "a registry refusal ($refusal) must fail the deploy"
	rm -- "$sandbox/registry-status-${refusal%:*}"
done
echo riscv64 >"$sandbox/daemon-arch"
[[ $(deploy "$c1") == 1 ]] && said 'HTTP 404 manifest for linux/riscv64' || fail 'an index without this platform must fail the deploy'
rm -- "$sandbox/daemon-arch"
# A pull that fails while the registry serves every part is tried once more, and fails the
# deploy if it fails again: the failure is on this host (a full disk, say), even when the
# message mentions a timeout.
echo 'write /app/server/node_modules/rxjs/internal/operators/timeout.js: no space left on device' >"$sandbox/pull-error"
for record in "$i_index $c1\n" "$i1 $c1\n"; do
	: >"$runs"
	green_run "$c1" "$record"
	: >"$log"
	[[ $(deploy "$c1") == 1 ]] && said 'no space left on device' || fail 'a local pull failure must fail the deploy'
	[[ $(grep -c '^pull ' "$log") == 2 ]] || fail "a local pull failure must be pulled twice: $(<"$log")"
done
rm -- "$sandbox/pull-error"
d=${i1#*@sha256:}
for labels in "$c0 https://github.com/eduard-cc/ember" "$c1 https://github.com/someone/ember" ' '; do
	echo "$labels" >"$sandbox/registry/$d/labels"
	[[ $(deploy "$c1") == 1 ]] && said 'is labelled' || fail "wrong labels must refuse: $labels"
done
echo "$c1 https://github.com/eduard-cc/ember" >"$sandbox/registry/$d/labels"
# A pull that fails once while the registry serves every part succeeds when tried again
# (here up to the launcher check below).
echo 'unexpected EOF' >"$sandbox/pull-error-once"
: >"$log"
[[ $(deploy "$c1") == 1 ]] && said 'run ops/install.sh' || fail 'a pull that succeeds when tried again must deploy'
[[ $(grep -c '^pull ' "$log") == 2 ]] || fail "a failed pull must be tried once more: $(<"$log")"
live "$c0" || fail 'nothing may have switched yet'

# The installed launcher must be this checkout's before an image release can start.
[[ $(deploy "$c1") == 1 ]] && said 'run ops/install.sh' || fail 'a missing launcher must refuse'
cp -- "$ops/start.sh" "$HOME/.local/lib/ember/start.sh"
echo '# older' >>"$HOME/.local/lib/ember/start.sh"
[[ $(deploy "$c1") == 1 ]] && said 'run ops/install.sh' || fail 'an outdated launcher must refuse'
cp -- "$ops/start.sh" "$HOME/.local/lib/ember/start.sh"
live "$c0" && ! logged backup || fail 'nothing may have switched or been backed up yet'
logged "pull $d" || fail 'the image must be pulled by digest'

# The first image release after a host-built one always takes the backup gate, even
# without migrations; a restored copy that differs from the live database stops it.
echo '12 0' >"$sandbox/restored-counts"
: >"$log"
[[ $(deploy "$c1") == 1 ]] && said 'restored copy differs' && live "$c0" || fail 'a differing restore must refuse'
said "first image release after the host-built $c0"
logged 'dropdb ember_restore_validation_' || fail 'the validation copy must be dropped'
rm -- "$sandbox/restored-counts"
: >"$log"
[[ $(deploy "$c1") == 0 ]] && live "$c1" || fail 'the first image release should deploy'
said "first image release after the host-built $c0"
said 'restore-tested backup kept at'
said 'records/migrations 12 1 in both'
logged 'backup ' && logged 'restore-check ' && logged 'dropdb ' || fail 'the gate must back up, restore-check and drop'
[[ $(<"$EMBER_HOME/releases/$c1/IMAGE") == "$i1" ]] || fail 'IMAGE must name the image by digest'
[[ $(<"$EMBER_HOME/releases/$c1/REVISION") == "$c1" ]] || fail 'REVISION must name the commit'
grep -qF "<title>$c1</title>" "$EMBER_HOME/releases/$c1/dist/index.html" || fail 'dist must be the image web shell'
[[ $(tail -n 1 "$EMBER_HOME/history") == "$c1" ]] || fail 'history must record the release'
[[ -z $(find "$EMBER_HOME/releases" -name '.image-record.*' -o -name '.build-*') ]] || fail 'temporary files left behind'

# Between image releases without migrations there is no backup; with one there is.
c2=$(commit app.txt)
green_run "$c2" "$(image "$c2") $c2\n"
: >"$log"
[[ $(deploy "$c2") == 0 ]] && live "$c2" && ! logged backup || fail 'an image release without migrations should deploy without a backup'
c3=$(commit app.txt)
green_run "$c3" "$(image "$c3" Second2) $c3\n"
: >"$log"
[[ $(deploy "$c3") == 0 ]] && live "$c3" && logged backup || fail 'a release with a migration should back up first'
said 'release adds migrations: Second2'
printf 'Initial1\nSecond2\n' >"$sandbox/applied"

# A docs-only commit has no image of its own: it runs its code commit's image, whether its
# own run published nothing or is still going.
c4=$(commit README.md)
green_run "$c4"
echo "$c4 in_progress  102" >>"$runs"
[[ $(deploy "$c4") == 0 ]] && live "$c4" || fail 'a docs-only commit should deploy'
[[ $(<"$EMBER_HOME/releases/$c4/IMAGE") == "$(<"$EMBER_HOME/releases/$c3/IMAGE")" ]] ||
	fail "a docs-only commit must use its code commit's image"

# A release lacking a migration the database has applied is refused.
c5=$(commit app.txt)
green_run "$c5" "$(image "$c5") $c5\n"
[[ $(deploy "$c5") == 1 ]] && said 'refusing to run old code on a newer schema' && live "$c4" ||
	fail 'a release missing an applied migration must refuse'

# An unhealthy release rolls back by itself and alerts.
c6=$(commit app.txt)
green_run "$c6" "$(image "$c6" Second2) $c6\n"
touch "$sandbox/unhealthy/$c6"
: >"$alerts"
[[ $(deploy "$c6") == 1 ]] && said 'rolled back to the previous release' && live "$c4" || fail 'an unhealthy release must roll back'
grep -qF "Deploy of ${c6:0:12} failed its health check, so it was rolled back to $c4" "$alerts" || fail 'the rollback must alert'
[[ $(tail -n 1 "$EMBER_HOME/history") == "$c4" ]] || fail 'a failed release must not enter history'
rm -- "$sandbox/unhealthy/$c6"

# ops/rollback.sh walks back across both kinds of release, down to the host-built one.
rollback() { "$ops/rollback.sh" >"$sandbox/out" 2>&1; }
rollback && live "$c3" || fail 'rollback from an image release'
rollback && rollback && live "$c1" || fail 'rollback between image releases'
rollback && live "$c0" || fail 'rollback to the host-built release'
rollback && fail 'rollback with no earlier release must fail'
live "$c0" || fail 'a refused rollback must leave the host-built release'
[[ $(<"$EMBER_HOME/auto-deploy.hold") == $(git -C "$sandbox/checkout" rev-parse origin/main) ]] ||
	fail 'a rollback must hold main'

# Rolling forward reuses a kept release without pulling, and takes the gate again after
# the host-built one. Releases history no longer names are removed with their images,
# unless a kept release still names the image (a docs-only commit shares its code's).
d1=${i1#*@sha256:} d3=$(cut -d@ -f2 <"$EMBER_HOME/releases/$c3/IMAGE")
d3=${d3#sha256:}
: >"$log"
[[ $(deploy "$c4") == 0 ]] && live "$c4" && said 'reusing the release' && ! logged pull || fail 'a kept release should be reused'
logged backup || fail 'the first image release after a host-built one takes the gate again'
[[ ! -e $EMBER_HOME/releases/$c1 && ! -e $EMBER_HOME/releases/$c3 && -e $EMBER_HOME/releases/$c0 ]] ||
	fail 'releases history no longer names should be removed'
logged "image rm $d1" || fail "a removed release's image should be removed"
! logged "image rm $d3" && [[ -e $sandbox/local/$d3 ]] || fail 'an image a kept release names must stay'
# A kept release whose image is gone from the daemon is fetched again.
rollback && live "$c0" || fail 'rollback to the host-built release again'
rm -- "$sandbox/local/$d3"
: >"$log"
[[ $(deploy "$c4") == 0 ]] && live "$c4" && said 'pulling' && logged "pull $d3" ||
	fail 'a kept release without its image should be fetched again'

# Five releases are kept from history, always including the host-built one until it
# falls out. Images are only ever removed by digest.
for _ in 1 2 3 4; do
	c=$(commit app.txt)
	green_run "$c" "$(image "$c" Second2) $c\n"
	[[ $(deploy "$c") == 0 ]] || fail 'more releases should deploy'
done
releases=$(find "$EMBER_HOME/releases" -mindepth 1 -maxdepth 1 -type d | wc -l)
[[ $releases == 5 && ! -e $EMBER_HOME/releases/$c0 && -e $EMBER_HOME/releases/$c4 ]] ||
	fail "the five newest releases should be kept, found $releases"
[[ -e $sandbox/local/$d3 ]] || fail 'the image of a kept release must stay in the daemon'
! grep -v '^image rm [0-9a-f]\{64\}$' "$log" | grep -q '^image rm' || fail 'images must be removed by digest'
newest=$c

# Deploying the live commit again is a no-op while it is what the deploy would make.
[[ $(deploy "$newest") == 0 ]] && said 'already live and healthy' || fail 'the live release should be left alone'

# A release rollback can return to is never replaced: not by a newer record of the same
# code, not by --host-build, and not while it is live.
mapfile -t kept < <(tail -n 3 "$EMBER_HOME/history")
green_run "${kept[0]}" "$(SALT=rerun image "${kept[0]}" Second2) ${kept[0]}\n"
before=$(<"$EMBER_HOME/releases/${kept[0]}/IMAGE")
[[ $(deploy "${kept[0]}") == 1 ]] && said 'that ops/rollback.sh can return to; refusing to replace it' || fail 'a history release must not be replaced'
[[ $(<"$EMBER_HOME/releases/${kept[0]}/IMAGE") == "$before" ]] && live "$newest" || fail 'a refused replacement must change nothing'
[[ $(deploy --host-build "${kept[1]}") == 1 ]] && said 'refusing to replace it' || fail '--host-build must not replace a history release'
[[ $(deploy --host-build "$newest") == 1 ]] && said 'the live release' && live "$newest" || fail '--host-build must not replace the live release'

# A release no rollback can return to (one whose health check failed) is replaced by a newer
# record of its code, and the image it named goes.
c=$(commit app.txt)
green_run "$c" "$(image "$c" Second2) $c\n"
touch "$sandbox/unhealthy/$c"
[[ $(deploy "$c") == 1 ]] && live "$newest" || fail 'an unhealthy release must roll back'
rm -- "$sandbox/unhealthy/$c"
old=$(cut -d: -f3 <"$EMBER_HOME/releases/$c/IMAGE")
green_run "$c" "$(SALT=rerun image "$c" Second2) $c\n"
: >"$log"
[[ $(deploy "$c") == 0 ]] && live "$c" && said 'pulling' || fail 'a newer record should replace a rejected release'
[[ $(<"$EMBER_HOME/releases/$c/IMAGE") == *"$(sha256sum <<<"image $c rerun" | cut -c1-64)" ]] || fail 'the release must name the newer image'
logged "image rm $old" || fail 'the replaced image should be removed'

# --host-build makes a host-built release of a commit no rollback can return to, reuses it
# later, and never pulls.
c=$(commit app.txt)
green_run "$c" "$(image "$c" Second2) $c\n"
: >"$log"
[[ $(deploy --host-build "$c") == 0 ]] && live "$c" && said "building $c on this host" && ! logged pull || fail '--host-build should build'
[[ -d $EMBER_HOME/releases/$c/server && ! -e $EMBER_HOME/releases/$c/IMAGE ]] || fail '--host-build should make a host-built release'
[[ $(deploy "$c") == 1 ]] && said 'the live release' || fail 'an image deploy must not replace a live host-built release'
rollback && [[ $(deploy --host-build "$c") == 0 ]] && live "$c" && said 'reusing the release' || fail '--host-build should reuse its release'
echo 'deploy checks passed'
