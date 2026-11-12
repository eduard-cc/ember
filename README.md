# Ember

A local-first mobile workout tracker with inspectable history, editable templates, and a separate privately hosted API. It keeps history imported from Strong exports with its source cells; the app itself has no import flow.

## Run locally

Requires compatible Node.js/npm (major in `.nvmrc`), Google Chrome for browser tests, and Ember's own rootless Docker daemon (see `docs/operations.md`) for the PostgreSQL/API integration checks.

```sh
npm --prefix apps/web ci --include=dev
npm --prefix apps/api ci --include=dev
npm --prefix apps/web run dev
```

Open http://127.0.0.1:5188. An ordinary installation starts empty. `/?demo=1` is an explicit synthetic demo for development and the e2e build; production builds ignore it. Do not synchronize demo profiles with personal history.

For the API (separate terminal; setup and credentials in `apps/api/README.md`):

```sh
ops/docker.sh compose -f ops/compose.local.yml up -d --wait
# once: create the ember_dev role and database, see apps/api/README.md
npm --prefix apps/api run migration
npm --prefix apps/api run dev
```

Vite proxies same-origin `/api/v1` to the API on loopback port 5190. Development and tests use the `ember_dev` database on loopback port 55439; test databases are created from it. The live app alone uses the `ember` database and port 5191; never point development at it. No default owner password exists: provision an owner hash through a secure local workflow, and never paste credentials into chat or tracked files.

## Checks

```sh
npm --prefix apps/web run format:check
npm --prefix apps/web run lint:check
npm --prefix apps/web run test:run
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
npm --prefix apps/web run test:e2e
npm --prefix apps/web run test:integration
npm --prefix apps/web run test:pwa
npm --prefix apps/api run lint:check
npm --prefix apps/api run typecheck
npm --prefix apps/api run build
npm --prefix apps/api run test:e2e
```

`format:check` runs Prettier over the whole repository from `apps/web`, which holds the Prettier install; `npm --prefix apps/web run format` rewrites files. `lint` in either app applies ESLint's automatic fixes. `test:integration` is local-only; CI runs the rest (see `docs/ci-and-tests.md`).

## Deploy and rollback

Main deploys itself within about five minutes of its CI passing (`ember-auto-deploy.timer`). The live app, its builds and its database run as the `ember` service account; run these from that account's checkout (`docs/operations.md`).

```sh
ops/deploy.sh <commit>   # build, switch, restart, health-check; rolls back on failure
ops/rollback.sh          # switch back to the previous healthy release
```

How releases are laid out and what the deploy checks: `docs/deploy.md`.

## Documentation

- `PRODUCT.md`: product scope, screens, analytics rules and open release gates
- `apps/web/DESIGN.md`: the visual system
- `AGENTS.md`: rules for agents working in this repository
- `apps/api/README.md`: local API, secrets, Tailscale owner mode, API contract
- `docs/ci-and-tests.md`: CI, local test runs, ports
- `docs/deploy.md`: release layout, deploy checks, live-app checks
- `docs/operations.md`: backups, restore drills, host isolation, resource limits
- `docs/sync-and-history.md`: saving guarantees, sync, recovery, history data
- `docs/phone-and-pwa.md`: UI conventions, gestures, offline shell
- `docs/catalog-drawings.md` and `apps/web/scripts/catalog/README.md`: exercise catalog, drawings and licensing

Personal history, private exports, credentials, database dumps and personal screenshots never enter tracked source, `apps/web/public/`, build output or external services. Tests use synthetic fixtures only.

## License

View only; see `LICENSE`. Third-party catalog content keeps its own licenses.
