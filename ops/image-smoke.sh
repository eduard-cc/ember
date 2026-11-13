#!/usr/bin/env bash
# Runtime smoke test of a built image, with synthetic settings only:
#   ops/image-smoke.sh <image>
# Starts a throwaway PostgreSQL on its own internal network under the alias ember-postgres,
# runs the image read-only, without capabilities and as its non-root user, and waits for
# /api/v1/health (startup migrations ran). A second container of the same image then fetches
# index.html, sw.js, the manifest and every precached file over that network, and each must
# match the copy `docker cp` takes out of the image byte for byte. Also checks that the image
# runs the Node version the Dockerfile pins. Locally it runs in Ember's own rootless daemon.
set -Eeuo pipefail
shopt -s inherit_errexit

image=${1:?usage: image-smoke.sh <image>}
here=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/docker-host.sh
source "$here/docker-host.sh"

# The same pin as ops/compose.local.yml (checked by apps/web/tests/postgres-image.test.ts).
postgres=postgres:17.12-bookworm
run=ember-image-smoke-$$-$RANDOM
db=$run-db
app=$run-app
work=$(mktemp -d)
cleanup() {
	docker rm -f "$app" "$db" >/dev/null 2>&1 || true
	docker network rm "$run" >/dev/null 2>&1 || true
	rm -rf -- "$work"
}
trap cleanup EXIT
fail() {
	echo "image smoke test failed: $*" >&2
	docker logs "$app" 2>&1 | tail -n 40 >&2 || true
	exit 1
}
hardened=(--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges)

pinned=$(sed -nE 's/^FROM node:([0-9]+\.[0-9]+\.[0-9]+)-bookworm-slim@sha256:[0-9a-f]{64} AS base$/v\1/p' "$here/../Dockerfile")
node=$(docker run --rm --network none "${hardened[@]}" --entrypoint node "$image" --version)
[[ -n $pinned && $node == "$pinned" ]] || fail "the image runs Node $node, the Dockerfile pins ${pinned:-nothing}"

docker network create --internal "$run" >/dev/null
docker run -d --name "$db" --network "$run" --network-alias ember-postgres \
	-e POSTGRES_USER=ember_smoke -e POSTGRES_PASSWORD=synthetic-smoke-only -e POSTGRES_DB=ember_smoke \
	"$postgres" >/dev/null
# Over TCP: the server initdb starts first listens on its socket only.
for _ in {1..60}; do
	docker exec "$db" pg_isready -q -h 127.0.0.1 -U ember_smoke -d ember_smoke && break
	sleep 1
done
docker exec "$db" pg_isready -q -h 127.0.0.1 -U ember_smoke -d ember_smoke || fail 'PostgreSQL did not start'

docker run -d --name "$app" --network "$run" --network-alias ember-app "${hardened[@]}" \
	-e DOTENV_CONFIG_PATH=/dev/null \
	-e EMBER_HOST=0.0.0.0 \
	-e EMBER_PORT=5191 \
	-e EMBER_ORIGIN=http://127.0.0.1:5191 \
	-e EMBER_SESSION_SECURE=false \
	-e EMBER_SESSION_TTL_SECONDS=60 \
	-e EMBER_AUTH_MODE=password \
	-e 'EMBER_OWNER_PASSWORD_HASH=$argon2id$synthetic' \
	-e EMBER_DATABASE_URL=postgres://ember_smoke:synthetic-smoke-only@ember-postgres:5432/ember_smoke \
	"$image" >/dev/null

uid=$(docker exec "$app" id -u) || fail 'could not run id in the app container'
[[ $uid =~ ^[0-9]+$ && $uid != 0 ]] || fail "the app runs as uid ${uid:-unknown}"

# Waits for health, then prints "<sha256> <path>" for every shell file it fetched. The list
# is parsed the way ops/lib.sh's deploy check parses it.
# shellcheck disable=SC2016 # JavaScript, expanded by node
client='
const {createHash} = require("node:crypto");
const base = "http://ember-app:5191";
(async () => {
	const deadline = Date.now() + 120_000;
	for (;;) {
		const ok = await fetch(base + "/api/v1/health").then((r) => r.ok, () => false);
		if (ok) break;
		if (Date.now() > deadline) throw new Error("/api/v1/health did not answer 200 within 120 s");
		await new Promise((r) => setTimeout(r, 1000));
	}
	const sw = require("node:fs").readFileSync("/app/web/sw.js", "utf8");
	const match = /^const URLS = (\[.*\]);$/m.exec(sw);
	if (!match) throw new Error("no URLS list in sw.js");
	const urls = JSON.parse(match[1]);
	if (!urls.length) throw new Error("empty URLS list in sw.js");
	for (const url of new Set(["/", "/index.html", "/sw.js", "/manifest.webmanifest", ...urls])) {
		const response = await fetch(base + url);
		if (!response.ok) throw new Error(`${url} answered ${response.status}`);
		const body = Buffer.from(await response.arrayBuffer());
		console.log(`${createHash("sha256").update(body).digest("hex")} ${url}`);
	}
})().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
'
served=$(docker run --rm --network "$run" "${hardened[@]}" --entrypoint node "$image" -e "$client") ||
	fail 'the app did not become healthy or did not serve its shell'

docker cp -q "$app:/app/web" "$work/web"
count=0
while read -r hash url; do
	[[ $url =~ ^/[A-Za-z0-9_./-]*$ && $url != *..* ]] || fail "unexpected precached path: $url"
	file=$work/web$url
	[[ $url == / ]] && file=$work/web/index.html
	[[ -f $file ]] || fail "$url is served but missing from the image's /app/web"
	[[ $(sha256sum <"$file" | cut -d' ' -f1) == "$hash" ]] || fail "$url differs from the image's /app/web copy"
	count=$((count + 1))
done <<<"$served"
((count > 4)) || fail 'the precache list was empty'
echo "image smoke test passed: $node as uid $uid, healthy, $count shell files served byte for byte"
