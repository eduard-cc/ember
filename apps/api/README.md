# Isolated local Ember API

NestJS 12, TypeORM explicit PostgreSQL migrations, independent Zod document validation.
No registration, telemetry, queues, remote resources or active-draft storage.
All fixtures are synthetic.

## Local resources and commands

Run from repository root:

```sh
ops/docker.sh compose -f ops/compose.local.yml up -d --wait
# Once: the unprivileged development role and database (Compose itself only creates the
# live ember database). Generate the role password locally; it goes only in apps/api/.env.
ops/docker.sh exec -it ember-postgres sh -c 'createuser -U "$POSTGRES_USER" --createdb --pwprompt ember_dev &&
  createdb -U "$POSTGRES_USER" -O ember_dev ember_dev &&
  psql -U "$POSTGRES_USER" -d postgres -c "REVOKE CONNECT, TEMPORARY ON DATABASE ember FROM PUBLIC"'
npm --prefix apps/api ci --include=dev
npm --prefix apps/api run migration
npm --prefix apps/api run dev
```

Development API binds **127.0.0.1:5190 only** and uses the `ember_dev` database; the live
app (`ember.service`) uses port 5191 and the `ember` database from external config. Origin is `http://127.0.0.1:5188`;
frontend must proxy `/api/v1` to the API or access it same-origin. No CORS is enabled.
Compose project `ember-local`; container `ember-postgres`;
image `postgres:17.12-bookworm`; port `127.0.0.1:55439`; named volume
`ember-data`; independent project network `ember-local_default`; all inside Ember's own
rootless Docker daemon (`ember-docker.service`, reached through `ops/docker.sh`).

```sh
npm --prefix apps/api run test:e2e
npm --prefix apps/api run test:e2e -- test/auth.e2e.test.ts
npm --prefix apps/api run test:e2e -- test/sync.e2e.test.ts
npm --prefix apps/api run test:e2e -- test/process.e2e.test.ts
npm --prefix apps/api run lint:check
npm --prefix apps/api run typecheck
npm --prefix apps/api run build
```

Tests compile first, enumerate actual test files, and fail on a missing file.
Each database integration test file creates and destroys its own
`ember_test_<pid>` database inside the task-owned container, administered through
`ember_dev`. Test setup refuses any other configured database, including live `ember`. Fault/delay triggers
never touch the ordinary database. HTTP requests are real loopback requests;
compiled-process coverage exercises TCP, authentication and replay, then stops the process.
Migrations are applied to empty test databases, not schema synchronization.
Development and tests connect as the `ember_dev` role: it owns `ember_dev`, may create
and drop its own test databases, is not a superuser and cannot connect to live `ember`.
Only the backup/restore scripts, and the backup test's cleanup of their validation copy, use
the Compose superuser, through `ops/docker.sh exec`. CI creates the same unprivileged role.
An existing setup with a superuser-owned `ember_dev` needs `createuser` plus
`ALTER DATABASE ember_dev OWNER TO ember_dev` instead of `createdb`. Percent-encode
reserved characters in the role password when writing the URL.

## Secret provisioning

`apps/api/.env` contains the nonsecret settings in `.env.example` plus the `ember_dev` role's
database URL and externally provisioned encoded Argon2id hash; it never holds the superuser
password. `apps/api/.postgres.env` contains only
`POSTGRES_USER=ember`, `POSTGRES_DB=ember`, and the generated database password.
Both are ignored and mode 0600. No plaintext owner password is stored.
The initial local hash was generated from a discarded random synthetic password;
there is intentionally no recoverable default login. Tests generate random passwords
in process memory and supply their hashes via environment variables.
Before interactive use, provision a new owner hash using a secure local terminal/UI
workflow; never paste credentials in chat or commit them. Existing sessions should be
revoked explicitly when changing owner credentials (no automatic password-rotation API).

Startup restricts host to loopback and database URLs to PostgreSQL on
`127.0.0.1:55439` with `ember` or `ember_*` database names. Insecure-cookie mode
requires an exact HTTP loopback origin. HTTPS mode sets Secure.
The stable synthetic single-owner identifier is `owner`, always derived server-side.

## Passwordless private Tailscale owner mode

Authentication defaults to `EMBER_AUTH_MODE=password`, preserving the existing
Argon2id login path. Explicitly opt in with `EMBER_AUTH_MODE=tailscale` and set
`EMBER_TAILSCALE_USER_LOGIN` to the exact owner login supplied by Tailscale Serve
(no trimming or case folding). In this mode no owner password hash is required.
Non-loopback origins must be exact HTTPS origins on a `.ts.net` hostname with
`EMBER_SESSION_SECURE=true`. Loopback HTTP origins remain available for isolated
tests/development with insecure cookies; the listener must still be `127.0.0.1`.

Use private [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve),
not Funnel. Serve strips incoming spoofed identity headers and supplies
`Tailscale-User-Login` for untagged tailnet devices. Tagged devices and Funnel do
not supply this user identity and are refused. Tailnet membership alone is not
owner authorization: shared users are refused unless their login exactly matches
the configured owner. Do not expose the API directly or use an untrusted proxy.
No client IP, `X-Forwarded-For`, or Express trust-proxy setting grants access.
Trusted local processes that can reach the loopback listener can spoof this
header; loopback is a trust boundary, not protection against hostile local code.

`POST /api/v1/session` with `{}` and the verified owner header returns HTTP 201
`{ownerId:"owner",csrfToken}` and a fresh opaque session cookie. The identity is
forwarded by Serve, never supplied by the browser. `GET /api/v1/session` with the
cookie and owner header returns the same owner and CSRF token while the session
is valid. Every session and sync request in this mode also checks owner identity;
a stolen cookie alone cannot bypass it. Missing/wrong identity returns 401.
Bootstrap keeps exact Origin protection; sync mutations and logout additionally
require the session CSRF token. Cookie hashing, expiration, HttpOnly,
SameSite=Strict, `/api/v1` scope and configured Secure behavior are unchanged.
Changing the configured owner does not revoke stored sessions automatically;
explicitly revoke existing sessions when transferring ownership.

Tests synthesize proxy identity only on real loopback HTTP requests against
migrated disposable PostgreSQL databases. To avoid a fixed-port process test and
avoid rebuilding shared `dist`, run from `apps/api/`:

```sh
node scripts/test-e2e.mjs test/tailscale-config.e2e.test.ts test/tailscale-auth.e2e.test.ts test/auth.e2e.test.ts test/config.e2e.test.ts test/sync.e2e.test.ts
```

No live Serve route, runtime environment, or deployment is changed by these tests.

## API contract

All paths below are prefixed `/api/v1`. Every response uses `Cache-Control: no-store`.
`GET /health` returns `{status:"ready"}` after a database readiness query.
`POST /session` accepts `{password}` in default password mode or `{}` in Tailscale mode; successful login returns
`{ownerId,csrfToken}` plus `ember_session` HttpOnly, SameSite=Strict cookie,
scoped to `/api/v1`, Secure when configured. Only the token hash is persisted in PostgreSQL.
`GET /session` returns current owner and CSRF token, or 401 for missing/revoked/expired session.
`DELETE /session` revokes that session and clears the cookie, returning `{loggedOut:true}`.
Every mutation requires the exact configured Origin; authenticated mutations also require
`X-CSRF-Token` matching the PostgreSQL session. Login itself uses exact-origin protection.
Password-mode login is limited to five attempts per minute, globally per API process, before Argon2 work.
This constant-space local limiter is not a distributed or restart-resistant deployment limiter.

`POST /sync/operations` accepts `{version:1,operations:[...]}` (1–50, at most 10 MiB).
Operation fields: UUID `operationId`, nonempty string `entityId`,
`kind` (`putBodyWeight`, `putWorkout`, `deleteWorkout`, `putTemplate`, `deleteTemplate`,
`putImportedWorkout`, `deleteImportedWorkout`), nullable `expectedRevision`,
and `payload` (Workout, BodyWeight or null). A BodyWeight is `{id,date,kg,deleted}`: a calendar-valid
local wall time, kg above 0 and at most 500 with at most two decimals, and a tombstone flag. It is
stored in the same generic `records`/`changes` tables; each kind may only revise records of its own
kind, so measurements and workouts can never overwrite each other. Measurement updates and
tombstones require the current revision, like templates. Source entity/set IDs are not forced to UUIDs.
All Workout fields including the optional completion flag and string-valued `original` evidence
are preserved (the retired `excluded`/`suspicious` set flags are accepted from older clients and dropped), with no timestamp conversion, name merging, set deduplication or analytics.
Unknown fields, nonfinite values and ID mismatches are rejected. Defensive bounds:
IDs 512 characters; names 1000; up to 1000 exercises and 5000 sets per exercise.
Dates are calendar-valid timezone-free `YYYY-MM-DDTHH:mm:ss` wall timestamps or
legacy empty strings; timezone suffixes, fractions and impossible dates are rejected.
Workout creates require at least one set and reject any explicitly uncompleted set;
absent completion flags are supported for historical imports. This does not allow clients
to sync active drafts: they must keep drafts entirely outside the operations contract.

Responses use the envelope **`{results:[ack,...]}`**.
Each ack has `{operationId,status,entityId,revision,changeSeq,errorCode?}`;
null revision/sequence means no accepted write. Malformed operation IDs are echoed only
for client diagnosis; schema rejections are not entered in the validated operation ledger.
Top-level invalid batches return 400. Each valid operation has its own transaction,
processed in input order; a database failure returns 500, so retry the immutable batch:
earlier committed operations replay their original acknowledgement.

A recursively key-sorted canonical validated payload is SHA-256 hashed in the ledger.
Same operation ID/same content returns its original accepted/conflict/semantic rejection;
different validated content returns `OPERATION_ID_REUSED` conflict without writes.
`expectedRevision:null` is create-only. Existing IDs cannot be silently recreated.
Template updates/deletes require the current revision. Deletion keeps a revisioned
tombstone that cannot be resurrected. The owner may edit finished
(`putWorkout`) and imported (`putImportedWorkout`) workouts at the current revision; an edit
still needs at least one set and no uncompleted set. `deleteWorkout` tombstones a native
workout at its current revision and is final. Every earlier revision stays in `changes`.
Each kind revises only its own records: native and imported history, templates and
measurements can never overwrite one another.
Imported history uses separate operation kinds. Strong import is retired in the app, but the
kinds stay for existing imported history: deletion tombstones only imported records at the
current revision, and a put at an imported tombstone's exact revision revives it.

`GET /sync/changes?after=0&limit=100` accepts safe integer cursor and limit 1–100.
Returns `{changes,nextCursor,hasMore}`; each change has
`{entityId,kind,revision,changeSeq,payload}`. Deleted-template payloads are null.
Body-weight changes require `X-Sync-Body-Weight: 1`; older apps receive only the kinds they
understand. Filtering happens before pagination, so the cursor remains the last returned change.
Upgraded apps replay from zero once to recover measurements hidden behind an older cursor.
`deleteWorkout` tombstones likewise require `X-Sync-Workout-Deletes: 1`, filtered before
pagination, and apps that send it keep their own cursor and replay from zero once.
The server bridge for an opt-in kind ships one release before the UI that writes it, so a
UI rollback lands on a server that still hides the new kind from the older app.
Legacy or rolled-back apps keep displaying deleted native workouts until upgraded; edits to
those stale copies conflict rather than resurrect them. Re-upgrading resumes the independent
workout-deletes cursor even if a legacy cursor has advanced meanwhile. A rolled-back app's
backup validator cannot export a still-pending `deleteWorkout`; let that operation sync or
return to the updated app before exporting.

Rollout is two releases: deploy this API compatibility bridge without the new frontend first,
then deploy the body-weight UI. Keep the bridge as the immediate rollback release: it accepts
measurement operations from cached new apps while keeping old apps' change feeds compatible.
Reverting the UI must retain the bridge; do not deploy a pre-bridge API after measurements exist.
Records, feed writes, sequence allocation and ledger writes commit atomically.
An owner-scoped transaction advisory lock is acquired **before** allocating sequence
values; the transactional sequence row prevents uncommitted writes from being skipped.
Concurrent stale edits, delayed commits, rollback/retry and pagination use real PostgreSQL tests.

## Boundaries

This README covers the API and its local setup. The live deployment (`ember.service` behind
Tailscale Serve), nightly encrypted off-device backups and the restore drill are described in
the root README.md. Browser sync, deliberate JSON restore and a local PostgreSQL
archive/restore drill are implemented and tested in the repository. Password mode is for
local development and tests; production uses Tailscale owner identity. Hardened
production database roles remain a release gate. Do not delete the
volume as a cleanup shortcut.
