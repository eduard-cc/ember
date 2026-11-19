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

Percent-encode reserved characters in the role password when writing the URL. The
container, its port and the development and live endpoints are in `ops/compose.local.yml`
and the root `AGENTS.md`. The development origin is `http://127.0.0.1:5188`; the frontend
proxies `/api/v1` to the API or reaches it same-origin. No CORS is enabled.

`test:e2e` builds the API (the process test starts the compiled server), then runs every
`test/*.e2e.test.ts` through `tsx`, or only the files passed after `--`.
Each database test file creates and destroys its own
`ember_test_<pid>` database inside the task-owned container, administered through
`ember_dev`. Test setup refuses any other configured database, including live `ember`. Fault/delay triggers
never touch the ordinary database. HTTP requests are real loopback requests;
compiled-process coverage exercises TCP, authentication and replay, then stops the process.
Migrations are applied to empty test databases, not schema synchronization.
Development and tests connect as the `ember_dev` role: it owns `ember_dev`, may create
and drop its own test databases, is not a superuser and cannot connect to live `ember`.
Only the backup/restore scripts, and the backup test's cleanup of their validation copy, use
the Compose superuser, through `ops/docker.sh exec`. CI creates the same unprivileged role.

## Secret provisioning

`apps/api/.env` contains the nonsecret settings in `.env.example` plus the `ember_dev` role's
database URL and externally provisioned encoded Argon2id hash; it never holds the superuser
password. `apps/api/.postgres.env` contains only
`POSTGRES_USER=ember`, `POSTGRES_DB=ember`, and the generated database password.
Both are ignored and mode 0600. No plaintext owner password is stored, and there is no
recoverable default login. Tests generate random passwords
in process memory and supply their hashes via environment variables.
Before interactive use, provision a new owner hash using a secure local terminal/UI
workflow; never paste credentials in chat or commit them. Existing sessions should be
revoked explicitly when changing owner credentials (no automatic password-rotation API).

Startup restricts the listener to loopback and the database to the Ember endpoints
(`apps/api/AGENTS.md`, Traps). Insecure-cookie mode
requires an exact HTTP loopback origin. HTTPS mode sets Secure.
The stable synthetic single-owner identifier is `owner`, always derived server-side.

## Passwordless private Tailscale owner mode

Authentication defaults to `EMBER_AUTH_MODE=password`, the Argon2id login path.
Explicitly opt in with `EMBER_AUTH_MODE=tailscale` and set
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

The identity is forwarded by Serve, never supplied by the browser. Every session and sync
request in this mode checks it, so a stolen cookie alone cannot bypass it; missing or wrong
identity returns 401. Changing the configured owner does not revoke stored sessions
automatically; explicitly revoke existing sessions when transferring ownership.

Tests synthesize proxy identity only on real loopback HTTP requests against
migrated disposable PostgreSQL databases. To avoid a fixed-port process test and
avoid rebuilding shared `dist`, run from `apps/api/` (after `npm run contracts:build` if
`packages/contracts` changed):

```sh
node scripts/test-e2e.mjs test/tailscale-config.e2e.test.ts test/tailscale-auth.e2e.test.ts test/auth.e2e.test.ts test/config.e2e.test.ts test/sync.e2e.test.ts
```

No live Serve route, runtime environment, or deployment is changed by these tests.

## API contract

The session and sync endpoints and their documents: `packages/contracts/README.md` (root).

## Boundaries

This README covers the API and its local setup. The live deployment (`ember.service` behind
Tailscale Serve), nightly encrypted off-device backups and the restore drill are described in
`ops/README.md` (root). Browser sync, deliberate JSON restore and a local PostgreSQL
archive/restore drill are implemented and tested in the repository. Password mode is for
local development and tests; production uses Tailscale owner identity. Hardened
production database roles remain a release gate. Do not delete the
volume as a cleanup shortcut.
