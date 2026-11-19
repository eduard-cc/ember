# Ember API agent instructions

Paths are relative to `apps/api` unless they start at the repository root.

## Read before touching

- `README.md`: local setup, secrets and Tailscale owner mode.
- The API contract, sync feed, opt-in kinds and retired fields: `packages/contracts/README.md` (root).
- Deploys, static files, backups and the PostgreSQL pin: `ops/README.md` (root).

## Commands

- Checks: `npm run lint:check`, `typecheck`, `build`, `test:e2e`. `lint` rewrites files; formatting runs from `apps/web`.
- The git-ignored `.env` (mode 0600) points at the `ember_dev` database on 127.0.0.1:55439.
- `contracts:build` compiles the root `packages/contracts` into the git-ignored `contracts/`, imported as `#contracts`. `build`, `typecheck`, `lint`, `lint:check`, `dev`, `migration` and `start:trial` run it first; rerun it by hand after editing the package for anything else.
- `test:e2e` runs every `test/*.e2e.test.ts` serially in its own `ember_test_<pid>` databases in the development container. Check that no other run uses that container before starting one.

## Traps

- Startup refuses any database host but `127.0.0.1` and any database outside the Ember endpoints: on port 55439 `ember` or `ember_<name>`, on the live port 55438 only `ember`. Inside the image (`EMBER_CONTAINER=1`) it accepts only `ember-postgres:5432` and listens on `EMBER_HOST=0.0.0.0`.
- Production runs the image (`Dockerfile`), which sets `EMBER_WEB_ROOT=/app/web`; never rely on the default web root in production.
- Wipe synced server data only through `resetDataset` (`src/sync/reset.ts`): it rotates the dataset epoch, so installs on the old epoch get 409 `DATASET_RESET` and drop their synced copies. A raw delete lets clients push their old records straight back.
- TypeORM's raw `query()` returns `[rows, count]` for an `UPDATE ... RETURNING`. Wrap it as `WITH updated AS (UPDATE ... RETURNING ...) SELECT ...` to get plain rows.
- Test lock contention with a trigger that delays the first write, and poll `pg_stat_activity` for its `PgSleep` wait before sending the second request, never a fixed sleep (`test/sync.e2e.test.ts`).
- Supertest's implicit `listen(0)` binds every interface; `test/helpers.ts` binds the app to 127.0.0.1 explicitly.
