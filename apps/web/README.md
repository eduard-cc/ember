# Ember web app

The React PWA. Commands run from the repository root; paths are relative to `apps/web` unless marked (root).

## Run locally

Requires compatible Node.js/npm (major in `.nvmrc`, root), Google Chrome for browser tests, and Ember's own rootless Docker daemon (`ops/README.md`, root) for the PostgreSQL/API integration checks.

```sh
npm --prefix apps/web ci --include=dev
npm --prefix apps/api ci --include=dev
npm --prefix apps/web run dev
```

Open http://127.0.0.1:5188. An ordinary installation starts empty. `/?demo=1` is an explicit synthetic demo for development and the e2e build; production builds ignore it. Do not synchronize demo profiles with personal history.

Vite proxies same-origin `/api/v1` to the API on loopback port 5190; run the API as `apps/api/README.md` (root) describes. Development and tests use the `ember_dev` database on loopback port 55439; test databases are created from it. The live app alone uses the `ember` database and port 5191; never point development at it.

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
```

`format:check` runs Prettier over the whole repository from `apps/web`, which holds the Prettier install; `npm --prefix apps/web run format` rewrites files. `lint` applies ESLint's automatic fixes. `test:integration` is local-only; CI runs the rest (`docs/ci-and-images.md`, root). Ports, Playwright and local test runs: `docs/testing.md`.

## Docs

- `PRODUCT.md`: product scope, screens, analytics rules and open release gates
- `DESIGN.md`: the visual system
- `docs/phone-and-pwa.md`: UI conventions, gestures, offline shell
- `docs/sync-and-history.md`: saving guarantees, sync, recovery, history data
- `docs/testing.md`: local test runs, ports, Playwright
- `docs/catalog.md`: exercise catalog, drawings and licensing
