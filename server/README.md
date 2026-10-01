# Isolated local Gym Log API

NestJS 11, TypeORM explicit PostgreSQL migrations, independent Zod document validation.
No registration, telemetry, queues, remote resources or active-draft storage.
All fixtures are synthetic. The ordinary database is empty after foundation verification.

## Local resources and commands

Run from repository root:

```sh
docker compose -f ops/compose.local.yml up -d --wait
npm --prefix server ci --include=dev
npm --prefix server run migration
npm --prefix server run dev
```

API binds **127.0.0.1:5190 only**. Origin is `http://127.0.0.1:5188`;
frontend must proxy `/api/v1` to the API or access it same-origin. No CORS is enabled.
Compose project `gym-log-local`; container `gym-log-local-postgres`;
image `postgres:17.6-bookworm`; port `127.0.0.1:55439`; named volume
`gym-log-local-data`; independent project network `gym-log-local_default`.

```sh
npm --prefix server run test:e2e
npm --prefix server run test:e2e -- test/auth.e2e.test.ts
npm --prefix server run test:e2e -- test/sync.e2e.test.ts
npm --prefix server run test:e2e -- test/process.e2e.test.ts
npm --prefix server run typecheck
npm --prefix server run build
```

Tests compile first, enumerate actual test files, and fail on a missing file.
Each database integration test file creates and destroys its own
`gym_log_test_<pid>` database inside the task-owned container. Fault/delay triggers
never touch the ordinary database. HTTP requests are real loopback requests;
compiled-process coverage exercises TCP, authentication and replay, then stops the process.
Migrations are applied to empty test databases, not schema synchronization.
The configured local DB user needs database-creation permission for this local test harness;
this Compose user is for isolated development, not a production least-privilege design.

## Secret provisioning

`server/.env` contains the nonsecret settings in `.env.example` plus the database URL
and externally provisioned encoded Argon2id hash. `server/.postgres.env` contains only
`POSTGRES_USER=gym_log`, `POSTGRES_DB=gym_log`, and the generated database password.
Both are ignored and mode 0600. No plaintext owner password is stored.
The initial local hash was generated from a discarded random synthetic password;
there is intentionally no recoverable default login. Tests generate random passwords
in process memory and supply their hashes via environment variables.
Before interactive use, provision a new owner hash using a secure local terminal/UI
workflow; never paste credentials in chat or commit them. Existing sessions should be
revoked explicitly when changing owner credentials (no automatic password-rotation API).

Startup restricts host to loopback and database URLs to PostgreSQL on
`127.0.0.1:55439` with `gym_log` or `gym_log_*` database names. Insecure-cookie mode
requires an exact HTTP loopback origin. HTTPS mode sets Secure; deployment is not done.
The stable synthetic single-owner identifier is `owner`, always derived server-side.

## Passwordless private Tailscale owner mode

Authentication defaults to `GYM_LOG_AUTH_MODE=password`, preserving the existing
Argon2id login path. Explicitly opt in with `GYM_LOG_AUTH_MODE=tailscale` and set
`GYM_LOG_TAILSCALE_USER_LOGIN` to the exact owner login supplied by Tailscale Serve
(no trimming or case folding). In this mode no owner password hash is required.
Non-loopback origins must be exact HTTPS origins on a `.ts.net` hostname with
`GYM_LOG_SESSION_SECURE=true`. Loopback HTTP origins remain available for isolated
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
avoid rebuilding shared `dist`, run from `server/`:

```sh
node scripts/test-e2e.mjs test/tailscale-config.e2e.test.ts test/tailscale-auth.e2e.test.ts test/auth.e2e.test.ts test/config.e2e.test.ts test/sync.e2e.test.ts
```

No live Serve route, runtime environment, or deployment is changed by these tests.

## API contract

All paths below are prefixed `/api/v1`. Every response uses `Cache-Control: no-store`.
`GET /health` returns `{status:"ready"}` after a database readiness query.
`POST /session` accepts `{password}` in default password mode or `{}` in Tailscale mode; successful login returns
`{ownerId,csrfToken}` plus `gym_log_session` HttpOnly, SameSite=Strict cookie,
scoped to `/api/v1`, Secure when configured. Only the token hash is persisted in PostgreSQL.
`GET /session` returns current owner and CSRF token, or 401 for missing/revoked/expired session.
`DELETE /session` revokes that session and clears the cookie, returning `{loggedOut:true}`.
Every mutation requires the exact configured Origin; authenticated mutations also require
`X-CSRF-Token` matching the PostgreSQL session. Login itself uses exact-origin protection.
Password-mode login is limited to five attempts per minute, globally per API process, before Argon2 work.
This constant-space local limiter is not a distributed or restart-resistant deployment limiter.

`POST /sync/operations` accepts `{version:1,operations:[...]}` (1–50, at most 10 MiB).
Operation fields match the plan: UUID `operationId`, nonempty string `entityId`,
`kind` (`putWorkout`, `putTemplate`, `deleteTemplate`, `putImportedWorkout`,
`deleteImportedWorkout`), nullable `expectedRevision`,
and `payload` (Workout or null). Source entity/set IDs are not forced to UUIDs.
All Workout fields including optional set flags and string-valued `original` evidence
are preserved, with no timestamp conversion, name merging, set deduplication or analytics.
Unknown fields, nonfinite values and ID mismatches are rejected. Defensive bounds:
IDs 512 characters; names 1000; up to 1000 exercises and 5000 sets per exercise.
Dates are calendar-valid timezone-free `YYYY-MM-DDTHH:mm:ss` wall timestamps or
legacy empty strings; timezone suffixes, fractions and impossible dates are rejected.
Workout creates require at least one set and reject any explicitly uncompleted set;
absent completion flags are supported for historical imports. This does not allow clients
to sync active drafts: they must keep drafts entirely outside the operations contract.

Response envelope refinement (not specified in the plan): **`{results:[ack,...]}`**.
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
tombstone that cannot be resurrected in this milestone. Native workout history is immutable.
Imported history uses separate operation kinds: replacement removes only imported records
at the current revision, and reimport may revive an imported tombstone at that exact revision.

`GET /sync/changes?after=0&limit=100` accepts safe integer cursor and limit 1–100.
Returns `{changes,nextCursor,hasMore}`; each change has
`{entityId,kind,revision,changeSeq,payload}`. Deleted-template payloads are null.
Records, feed writes, sequence allocation and ledger writes commit atomically.
An owner-scoped transaction advisory lock is acquired **before** allocating sequence
values; the transactional sequence row prevents uncommitted writes from being skipped.
Concurrent stale edits, delayed commits, rollback/retry and pagination use real PostgreSQL tests.

## Boundaries

This is a local API foundation, not production deployment or off-device backup.
Browser sync, reviewed imported-only replacement, deliberate JSON restore, and a local
PostgreSQL archive/restore drill are implemented and tested in the repository.
Interactive password provisioning, private HTTPS deployment, hardened production DB roles,
and automated off-device encrypted backups remain release gates. Do not delete the volume
as a cleanup shortcut.
