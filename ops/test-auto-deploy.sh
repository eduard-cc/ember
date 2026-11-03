#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of ops/auto-deploy.sh against a throwaway git origin, a fake `gh` that
# reports CI results, a fake `hermes` that records alerts and a stub deploy.sh. Never
# touches the live app, the real repository or GitHub.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-auto-deploy-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
fail() {
	echo "auto-deploy check failed: $*" >&2
	exit 1
}

export HOME=$sandbox/home EMBER_HOME=$sandbox/home/ember
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.invalid
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.invalid
mkdir -p "$HOME" "$EMBER_HOME/releases" "$sandbox/bin"
ci=$sandbox/ci alerts=$sandbox/alerts deploys=$sandbox/deploys
touch "$ci" "$alerts" "$deploys"

# gh prints the CI runs (already in the --jq output format), or fails when GitHub is "down".
# gh-hook, when present, runs first: it stands in for something happening between
# auto-deploy's first look and its deploy.
cat >"$sandbox/bin/gh" <<EOF
#!/usr/bin/env bash
[[ ! -e $sandbox/gh-hook ]] || bash -- "$sandbox/gh-hook"
[[ ! -e $sandbox/gh-down ]] && cat -- "$ci"
EOF
cat >"$sandbox/bin/hermes" <<EOF
#!/usr/bin/env bash
echo "\${@: -1}" >>"$alerts"
EOF
# curl records its arguments, the URL from its --config file and the posted body.
cat >"$sandbox/bin/curl" <<EOF
#!/usr/bin/env bash
echo "\$*" >"$sandbox/curl-args"
while ((\$#)); do [[ \$1 != --config ]] || cat -- "\$2" >"$sandbox/curl-config"; shift; done
cat >"$sandbox/curl-body"
EOF
chmod +x "$sandbox/bin/gh" "$sandbox/bin/hermes" "$sandbox/bin/curl"
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
c1=$(commit app.txt)
git clone --quiet "$sandbox/origin.git" "$sandbox/checkout"

# The scripts under test live in the checkout, as on the host; deploy.sh is a stub that
# records the commit and switches `current` unless told to fail with a given exit code.
mkdir -p "$sandbox/checkout/ops"
cp -- "$SCRIPT_DIR/auto-deploy.sh" "$SCRIPT_DIR/lib.sh" "$SCRIPT_DIR/notify.sh" "$sandbox/checkout/ops/"
# Told "killed", it terminates auto-deploy mid-deploy, as a systemd timeout would. Like
# the real one it takes the deploy lock first, which it inherits from auto-deploy.
cat >"$sandbox/checkout/ops/deploy.sh" <<EOF
#!/usr/bin/env bash
SCRIPT_DIR=$sandbox/checkout/ops
source "\$SCRIPT_DIR/lib.sh"
lock
echo "\$1" >>"$deploys"
cat -- "$EMBER_HOME/auto-deploy.hold" >"$sandbox/hold-during-deploy" 2>/dev/null || true
rc=\$(cat -- "$sandbox/deploy-rc" 2>/dev/null || echo 0)
[[ \$rc != killed ]] || { kill -KILL "\$PPID"; exit 1; }
((rc)) || ln -sfn "releases/\$1" "$EMBER_HOME/current"
exit "\$rc"
EOF
chmod +x "$sandbox/checkout/ops/deploy.sh"

run() { "$sandbox/checkout/ops/auto-deploy.sh" >/dev/null 2>&1 || fail "auto-deploy.sh exited non-zero ($*)"; }
deploy_count() { wc -l <"$deploys"; }
alert_count() { wc -l <"$alerts"; }
live() { [[ $(readlink -- "$EMBER_HOME/current" 2>/dev/null) == "releases/$1" ]]; }
held_sha() { cat -- "$EMBER_HOME/auto-deploy.hold" 2>/dev/null || true; }

# A commit without a CI run yet, or with one still running, waits quietly.
run 'no CI run'
echo "$c1 in_progress " >"$ci"
run 'CI running'
[[ $(deploy_count) == 0 && $(alert_count) == 0 && -z $(held_sha) ]] || fail 'pending CI must not deploy, hold or alert'

# Green CI fast-forwards the checkout and deploys main once.
echo "$c1 completed success" >"$ci"
run 'green CI'
live "$c1" && [[ $(deploy_count) == 1 ]] || fail 'green CI should deploy main'
[[ $(git -C "$sandbox/checkout" rev-parse HEAD) == "$c1" ]] || fail 'the checkout should be fast-forwarded to main'
run 'already live'
[[ $(deploy_count) == 1 ]] || fail 'a live main must not be deployed again'

# A failed deploy is held: one alert, never retried.
c2=$(commit app.txt)
echo "$c2 completed success" >>"$ci"
echo 1 >"$sandbox/deploy-rc"
run 'failing deploy'
run 'held commit'
[[ $(deploy_count) == 2 && $(held_sha) == "$c2" ]] || fail 'a failed deploy should be held and not retried'
[[ $(alert_count) == 1 ]] && grep -q "Auto-deploy of ${c2:0:12} failed" "$alerts" || fail 'a failed deploy should alert once'

# A docs-only commit inherits its code commit's CI and replaces the hold.
rm -f -- "$sandbox/deploy-rc"
c3=$(commit README.md)
run 'docs-only commit'
live "$c3" || fail 'a docs-only commit after green code should deploy'

# Failed CI is held with one alert and nothing is deployed.
c4=$(commit app.txt)
echo "$c4 completed failure" >>"$ci"
run 'red CI'
run 'red CI again'
[[ $(deploy_count) == 3 && $(held_sha) == "$c4" ]] && live "$c3" || fail 'red CI must not deploy'
[[ $(alert_count) == 2 ]] && grep -q "CI failed on main at ${c4:0:12}" "$alerts" || fail 'red CI should alert once'

# GitHub or the origin being unreachable is not a failure: no hold, no alert.
c5=$(commit app.txt)
echo "$c5 completed success" >>"$ci"
touch "$sandbox/gh-down"
run 'GitHub down'
rm -f -- "$sandbox/gh-down"
git -C "$sandbox/checkout" remote set-url origin "$sandbox/missing.git"
run 'origin unreachable'
git -C "$sandbox/checkout" remote set-url origin "$sandbox/origin.git"
[[ $(deploy_count) == 3 && $(alert_count) == 2 && $(held_sha) == "$c4" ]] || fail 'an unreachable GitHub must only wait'

# A deploy or rollback already running, or GitHub failing during the deploy's own
# checks: try again next run, keeping the earlier hold and without an alert.
echo 75 >"$sandbox/deploy-rc"
run 'deploy lock busy'
echo 69 >"$sandbox/deploy-rc"
run 'GitHub down during the deploy'
[[ $(deploy_count) == 5 && $(alert_count) == 2 && $(held_sha) == "$c4" ]] ||
	fail 'a busy lock or unreachable GitHub during the deploy must not hold or alert'
rm -f -- "$sandbox/deploy-rc"
run 'lock free again'
live "$c5" && [[ $(deploy_count) == 6 ]] || fail 'the commit should deploy once the lock is free'
[[ $(cat -- "$sandbox/hold-during-deploy") == "$c5" ]] || fail 'the commit should be held while it deploys'

# A deploy killed midway (a systemd timeout) leaves the commit held, so it is not retried.
c5b=$(commit app.txt)
echo "$c5b completed success" >>"$ci"
echo killed >"$sandbox/deploy-rc"
("$sandbox/checkout/ops/auto-deploy.sh" >/dev/null 2>&1; exit $?) 2>/dev/null && fail 'a killed auto-deploy should exit non-zero'
rm -f -- "$sandbox/deploy-rc"
run 'after a killed deploy'
[[ $(deploy_count) == 7 && $(held_sha) == "$c5b" ]] && live "$c5" || fail 'a killed deploy must stay held'
c5=$c5b

# A manual rollback (ops/rollback.sh calls hold_main) keeps main off, however many
# rollbacks follow, until a newer commit lands.
rm -f -- "$EMBER_HOME/auto-deploy.hold"
ln -sfn "releases/$c3" "$EMBER_HOME/current"
for _ in 1 2; do (SCRIPT_DIR=$sandbox/checkout/ops && source "$SCRIPT_DIR/lib.sh" && hold_main); done
run 'after rollbacks'
[[ $(held_sha) == "$c5" && $(deploy_count) == 7 ]] && live "$c3" || fail 'main must stay off after a rollback'

# While the timer decides and deploys, a rollback cannot take the lock; and a rollback
# or deploy holding the lock makes the timer wait without a hold or an alert.
c5c=$(commit app.txt)
echo "$c5c completed success" >>"$ci"
rm -f -- "$EMBER_HOME/auto-deploy.hold"
printf 'flock -n %q true && touch %q\n' "$EMBER_HOME/deploy.lock" "$sandbox/rollback-ran" >"$sandbox/gh-hook"
echo 1 >"$sandbox/deploy-rc"
run 'rollback attempted during the check'
rm -f -- "$sandbox/gh-hook" "$sandbox/deploy-rc"
[[ ! -e $sandbox/rollback-ran ]] || fail 'a rollback must not run while the timer holds the lock'
[[ $(deploy_count) == 8 && $(held_sha) == "$c5c" && $(alert_count) == 3 ]] || fail 'the failed deploy should be held'
rm -f -- "$EMBER_HOME/auto-deploy.hold"
: >"$alerts"
flock "$EMBER_HOME/deploy.lock" "$sandbox/checkout/ops/auto-deploy.sh" >/dev/null 2>&1 ||
	fail 'auto-deploy.sh exited non-zero (lock held)'
[[ $(deploy_count) == 8 && -z $(held_sha) && $(alert_count) == 0 ]] || fail 'a held lock must only wait'
run 'lock released'
live "$c5c" && [[ $(deploy_count) == 9 ]] || fail 'main should deploy once the lock is free'
c5=$c5c

# A checkout that is not on main is never merged into; the commit is held with an alert.
c6=$(commit app.txt)
echo "$c6 completed success" >>"$ci"
git -C "$sandbox/checkout" switch --quiet -c side
run 'checkout on a branch'
[[ $(git -C "$sandbox/checkout" rev-parse HEAD) == "$c5" && $(deploy_count) == 9 && $(held_sha) == "$c6" ]] ||
	fail 'a checkout off main must not be merged or deployed'
grep -q 'not a main checkout' "$alerts" || fail 'a checkout off main should alert'

# With a webhook configured (the service account), alerts go there instead of through
# Hermes, mention nobody, and the webhook URL never appears on a command line.
git -C "$sandbox/checkout" switch --quiet main
webhook=https://discord.example.invalid/api/webhooks/1/synthetic-token
mkdir -p "$HOME/.config/ember"
echo "$webhook" >"$HOME/.config/ember/discord-webhook"
c7=$(commit app.txt)
echo "$c7 completed failure" >>"$ci"
before=$(alert_count)
run 'red CI with a webhook'
[[ $(held_sha) == "$c7" && $(alert_count) == "$before" ]] || fail 'a webhook alert must not go through Hermes'
[[ $(cat -- "$sandbox/curl-config") == "url = \"$webhook\"" ]] || fail 'the alert should be posted to the webhook'
jq -e --arg sha "${c7:0:12}" \
	'(.content | startswith("[ember] CI failed on main at " + $sha)) and .allowed_mentions.parse == []' \
	"$sandbox/curl-body" >/dev/null || fail 'the webhook alert should carry the message without mentions'
! grep -q synthetic-token "$sandbox/curl-args" || fail 'the webhook URL must not be on the command line'

echo 'auto-deploy checks passed'
