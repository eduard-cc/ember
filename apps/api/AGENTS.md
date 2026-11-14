# Ember API agent instructions

NestJS 12 sync API with TypeORM and explicit PostgreSQL migrations. Paths below are relative to `apps/api` unless they start at the repository root. Repo-wide rules (architecture, production data, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- `README.md`: local setup, secrets and Tailscale owner mode.
- The API contract, sync feed, opt-in kinds and retired fields: `packages/contracts/README.md` (root). Wiping server data: `docs/sync.md`.
- Deploys, the release layout, static files, backups, the Docker daemon and the PostgreSQL pin: `ops/README.md` (root).

## Commands

- Setup: `npm ci --include=dev`; the git-ignored `.env` (mode 0600) points at the `ember_dev` database on 127.0.0.1:55439.
- `contracts:build` compiles the root `packages/contracts` into the git-ignored `contracts/`, imported as `#contracts`; `build`, `typecheck`, `dev`, `migration` and `start:trial` run it first. Rerun it after editing the package.
- Checks: `npm run lint:check`, `typecheck`, `build`, `test:e2e`. `lint` rewrites files; formatting runs from `apps/web` (`npm --prefix apps/web run format:check`).
- `test:e2e` builds first, runs every `test/*.e2e.test.ts` serially through `ops/limited.sh` (in `ember-jobs.slice`; without the installed slice or a user systemd session it exits with an error, and under `CI=true` it runs the command directly), and creates and drops its own `ember_test_<pid>` databases in the development container. Check that no other run uses that container before starting one.

## Traps

- Startup refuses any database other than `ember` or `ember_*` on the expected loopback ports, and any host but `127.0.0.1`; inside the image (`EMBER_CONTAINER=1`) it accepts only `ember-postgres:5432` and `EMBER_HOST=0.0.0.0` instead. Tests and scripts must never target `ember`.
- Migrations are forward-only and run on startup; a migration that rewrites stored fields is a bulk data change (root `AGENTS.md`, "Production data").
- Production runs the image (`Dockerfile`), which sets `EMBER_WEB_ROOT=/app/web` and `EMBER_CONTAINER=1`; a release names that image by digest and keeps a copy of its web shell in `dist/` for the deploy's checks (`ops/README.md`, root). Never rely on the default web root in production.
- `packages/contracts/src/static-files.ts` (root) is the single allowlist of served shell files; the web build checks its precache against it, so widening it changes what the service worker may precache.
- The documents the API accepts are the shared schemas from `#contracts` plus the size bounds in `src/sync/schema.ts`. Keep bounds here, never in the package: the web app must never newly reject documents already stored on a device.
