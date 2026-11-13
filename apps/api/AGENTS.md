# Ember API agent instructions

NestJS 12 sync API with TypeORM and explicit PostgreSQL migrations. Paths below are relative to `apps/api` unless they start at the repository root. Repo-wide rules (architecture, production data, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- `README.md`: local setup, secrets, Tailscale owner mode and the API contract.
- Sync feed, opt-in kinds, retired fields, dataset resets: `docs/sync-and-history.md` (root).
- Deploys, the release layout and static files: `docs/deploy.md` (root). Backups, the Docker daemon and the PostgreSQL pin: `docs/operations.md` (root).

## Commands

- Setup: `npm ci --include=dev`; the git-ignored `.env` (mode 0600) points at the `ember_dev` database on 127.0.0.1:55439. The date-contract test also needs `npm ci` in `apps/web`, whose schemas it loads.
- Checks: `npm run lint:check`, `typecheck`, `build`, `test:e2e`. `lint` rewrites files; formatting runs from `apps/web` (`npm --prefix apps/web run format:check`).
- `test:e2e` builds first, runs every `test/*.e2e.test.ts` serially through `ops/limited.sh`, and creates and drops its own `ember_test_<pid>` databases in the development container. Check that no other run uses that container before starting one.

## Traps

- Startup refuses any database other than `ember` or `ember_*` on the expected loopback ports, and any host but `127.0.0.1`; inside the image (`EMBER_CONTAINER=1`) it accepts only `ember-postgres:5432` and `EMBER_HOST=0.0.0.0` instead. Tests and scripts must never target `ember`.
- Migrations are forward-only and run on startup; a migration that rewrites stored fields is a bulk data change (root `AGENTS.md`, "Production data").
- Production runs the image (`Dockerfile`), which sets `EMBER_WEB_ROOT=/app/web` and `EMBER_CONTAINER=1`; a release names that image by digest and keeps a copy of its web shell in `dist/` for the deploy's checks (`docs/deploy.md`). Never rely on the default web root in production.
- `src/static-files.ts` is the single allowlist of served shell files; the web build imports it, so widening it changes what the service worker may precache.
- The documents the API accepts must stay in step with `apps/web/shared/`; `test/date-contract.e2e.test.ts` checks that the web schemas accept the feed the API returns.
