# Ember

A local-first mobile workout tracker with inspectable history, editable templates, and a separate privately hosted API. Ember is the source of truth for the owner's training history: their Strong history was imported once and Strong import is retired.

## Run locally

Requires compatible Node.js/npm (major in `.nvmrc`), Google Chrome for browser tests, and Ember's own rootless Docker daemon (see `docs/operations.md`) for the PostgreSQL/API integration checks.

```sh
npm ci --include=dev
npm --prefix server ci --include=dev
npm run dev
```

Open http://127.0.0.1:5188. An ordinary installation starts empty. `/?demo=1` is an explicit **development-only** synthetic demo; production builds ignore it. Do not synchronize demo profiles with personal history.

For the API (separate terminal; setup and credentials in `server/README.md`):

```sh
ops/docker.sh compose -f ops/compose.local.yml up -d --wait
# once: create the ember_dev role and database, see server/README.md
npm --prefix server run migration
npm --prefix server run dev
```

Vite proxies same-origin `/api/v1` to the API on loopback port 5190. Development and tests use the `ember_dev` database on loopback port 55439; test databases are created from it. The live app alone uses the `ember` database and port 5191; never point development at it. No default owner password exists: provision an owner hash through a secure local workflow, and never paste credentials into chat or tracked files.

## Checks

```sh
npm run format:check
npm run lint:check
npm run test:run
npm run typecheck
npm run build
npm run test:e2e
npm run test:integration
npm run test:pwa
npm --prefix server run lint:check
npm --prefix server run typecheck
npm --prefix server run build
npm --prefix server run test:e2e
```

`npm run lint` and `npm --prefix server run lint` apply ESLint's automatic fixes. `test:integration` is local-only; CI runs the rest (see `docs/ci-and-tests.md`).

## Deploy and rollback

```sh
ops/deploy.sh <commit>   # build, switch, restart, health-check; rolls back on failure
ops/rollback.sh          # switch back to the previous healthy release
```

How releases are laid out and what the deploy checks: `docs/deploy.md`.

## Documentation

- `PRODUCT.md`: product scope, screens, analytics rules and open release gates
- `DESIGN.md`: the visual system
- `AGENTS.md`: rules for agents working in this repository
- `server/README.md`: local API, secrets, Tailscale owner mode, API contract
- `docs/ci-and-tests.md`: CI, its budget, local test runs, ports
- `docs/deploy.md`: release layout, deploy checks, live-app checks
- `docs/operations.md`: backups, restore drills, host isolation, resource limits
- `docs/sync-and-history.md`: saving guarantees, sync, recovery, history data
- `docs/phone-and-pwa.md`: UI conventions, gestures, offline shell
- `docs/catalog-drawings.md` and `scripts/catalog/README.md`: exercise catalog, drawings and licensing

Personal history, private exports, credentials, database dumps and personal screenshots never enter tracked source, `public/`, build output or external services. Tests use synthetic fixtures only.
