#!/usr/bin/env bash
# shellcheck disable=SC2015 # every fail() exits, so A && B || fail is intended
# Local check of ops/dependency-check.sh with fake npm, node, curl and hermes. Never
# touches the registry, nodejs.org, the kanban board or the live app.
set -Eeuo pipefail
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
sandbox=$(mktemp -d "${TMPDIR:-/tmp}/ember-dependency-check-test.XXXXXX")
trap 'rm -rf -- "$sandbox"' EXIT
fail() {
	echo "dependency check test failed: $*" >&2
	exit 1
}

# The cron runs an installed copy outside the checkout and points it at the checkout.
repo=$sandbox/repo
mkdir -p "$repo/apps/web" "$repo/apps/api" "$sandbox/bin" "$sandbox/installed"
cp -- "$SCRIPT_DIR/dependency-check.sh" "$sandbox/installed/"
echo 26 >"$repo/.nvmrc"
clean='{"vulnerabilities":{},"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'
echo "$clean" >"$repo/apps/web/audit.json"
echo "$clean" >"$repo/apps/api/audit.json"
echo v26.12.1 >"$sandbox/node-version"
cat >"$sandbox/index.json" <<'EOF'
[{"version":"v27.1.0","security":true},{"version":"v26.13.0","security":false},
 {"version":"v26.12.1","security":true},{"version":"v26.8.1","security":false},
 {"version":"v26.0.0-rc.1","security":true}]
EOF

# npm prints the audit.json of the directory it runs in and exits 1, as when it finds
# something; a missing file stands in for an unreachable registry.
cat >"$sandbox/bin/npm" <<'EOF'
#!/usr/bin/env bash
[[ -e audit.json ]] && cat audit.json
exit 1
EOF
cat >"$sandbox/bin/node" <<EOF
#!/usr/bin/env bash
cat -- "$sandbox/node-version"
EOF
cat >"$sandbox/bin/curl" <<EOF
#!/usr/bin/env bash
cat -- "$sandbox/index.json"
EOF
# hermes records each new card's key and body; a key it has seen returns the old card.
cat >"$sandbox/bin/hermes" <<EOF
#!/usr/bin/env bash
key=\$(sed -n 's/.*--idempotency-key \([^ ]*\).*/\1/p' <<<"\$*")
if grep -qxF -- "\$key" "$sandbox/keys" 2>/dev/null; then
	echo '{"created_at": 1}'
else
	echo "\$key" >>"$sandbox/keys"
	echo "\$*" >"$sandbox/args"
	cat >"$sandbox/body"
	echo "{\"created_at\": \$(date +%s)}"
fi
EOF
chmod +x "$sandbox/bin/"*
export PATH=$sandbox/bin:$PATH EMBER_NODE=$sandbox/bin/node EMBER_REPO=$repo
run() { "$sandbox/installed/dependency-check.sh" 2>"$sandbox/err"; }

# Clean dependencies on the newest security release of the .nvmrc major: silence, no card.
out=$(run) && [[ -z $out && ! -e $sandbox/keys ]] || fail "clean run: $out"

# A high production advisory and a Node security release queue one card naming both.
echo '{"vulnerabilities":{"qs":{"name":"qs","severity":"high"},"x":{"name":"x","severity":"moderate"}},"metadata":{"vulnerabilities":{}}}' >"$repo/apps/api/audit.json"
echo v26.8.1 >"$sandbox/node-version"
out=$(run) || fail "findings run: $(cat "$sandbox/err")"
[[ $out == *'found 2 issue(s)'* ]] || fail "findings output: $out"
grep -qF 'npm (api): qs has a high advisory' "$sandbox/body" || fail 'advisory missing from card'
grep -qF 'security release 26.12.1 is out' "$sandbox/body" || fail 'Node release missing from card'
grep -qF -- "--workspace worktree:$repo" "$sandbox/args" || fail 'card not anchored to the checkout'
! grep -qF 'x has' "$sandbox/body" || fail 'moderate advisory on card'

# The same findings next month, after a non-security Node release: the existing card is
# kept, nothing is posted.
sed -i 's/v26.13.0/v26.14.0/' "$sandbox/index.json"
out=$(run) && [[ -z $out && $(wc -l <"$sandbox/keys") -eq 1 ]] || fail "repeat run: $out"

# A card that cannot be created fails loudly.
mv "$sandbox/bin/hermes" "$sandbox/hermes"
printf '#!/usr/bin/env bash\nexit 1\n' >"$sandbox/bin/hermes" && chmod +x "$sandbox/bin/hermes"
echo v26.7.0 >"$sandbox/node-version"
! out=$(run) && grep -qF 'could not create the kanban card' "$sandbox/err" || fail "card failure: $out"
mv "$sandbox/hermes" "$sandbox/bin/hermes"

# An unreachable Node release index fails loudly instead of reporting clean.
mv "$sandbox/index.json" "$sandbox/index.json.off"
! out=$(run) && grep -qF 'could not read the Node release index' "$sandbox/err" || fail "index failure: $out"
mv "$sandbox/index.json.off" "$sandbox/index.json"

# A Node major behind .nvmrc is a finding of its own.
echo "$clean" >"$repo/apps/api/audit.json"
echo v25.9.0 >"$sandbox/node-version"
out=$(run) && grep -qF 'runs 25.9.0 but .nvmrc (and CI) use 26' "$sandbox/body" || fail "major drift: $out"

# An audit that cannot reach the registry fails loudly instead of reporting clean.
rm "$repo/apps/web/audit.json"
! out=$(run) && grep -qF 'npm audit failed in apps/web' "$sandbox/err" || fail "audit failure: $out"
echo 'dependency check test passed'
