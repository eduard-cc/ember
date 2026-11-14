# Ember web agent instructions

The React PWA: React 19 + TypeScript, Vite, Tailwind v4 with shadcn-style Radix wrappers, Dexie for local storage, Vitest and Playwright. Paths below are relative to `apps/web` unless they start at the repository root. Repo-wide rules (product direction, analytics invariants, production data, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- `README.md`: local setup, dev server, demo mode, checks. `PRODUCT.md`: product scope and release gates.
- UI, layout, accessibility, phone gestures, installed PWA: `docs/phone-and-pwa.md` and `DESIGN.md`.
- Local storage, sync client, recovery, history editing: `docs/sync-and-history.md`; sync protocol rules: `packages/contracts/README.md` (root).
- Catalog data and drawings: `docs/catalog.md`. Never hand-edit `src/catalog/exercises.json`; change the inputs and run the scripts.
- Playwright, ports, flaky or killed runs: `docs/testing.md`.

## Layout

- Metrics and analytics are pure functions in `src/domain/`, separate from UI and state.
- The document schemas (workouts, templates, body weight, operations, stored state) come from `@ember/contracts`, an alias to the root `packages/contracts/src` (`contracts.config.ts`, `tsconfig.json` paths). The API validates the same schemas plus its size bounds; read `packages/contracts/README.md` (root) before changing them. `shared/backup.ts` holds the backup document schema, which only this app uses.
- `tests/`: Vitest unit tests at the top level, Playwright suites in `tests/e2e/` and `tests/pwa/`, and the local-only `tests/integration/`.
- `scripts/`: the exercise catalog pipeline, the integration harness and the PWA build (`scripts/pwa-build.ts`).

## Commands

- Setup: `npm ci --include=dev` here and in `apps/api` (a unit test imports the API's security headers; the integration harness builds the API and loads its `pg`, `argon2` and `dotenv`).
- Checks: `npm run format:check` (Prettier over the whole repository), `lint:check`, `typecheck`, `build`, `test:run`, `test:e2e`, `test:pwa`, `test:integration`. `format` and `lint` rewrite files.
- `test:integration` needs the git-ignored `apps/api/.env` pointing at `ember_dev` (`docs/testing.md`); it is not in CI.

## Traps

- Playwright `test:e2e` builds into `dist-e2e/` and previews on 5188; tests tagged `@dev-server` run on a dev server on 5189, because only it serves `/src/...` modules. Tag every test that imports or routes source modules, or it passes without testing anything.
- `test:pwa` builds `dist/` and previews on 5193, and its lifecycle tests rewrite `dist/sw.js`: never run it alongside another suite that uses that build.
- `scripts/pwa-build.ts` imports the server's static-file rule (`packages/contracts/src/static-files.ts`, by path: Vite bundles its config before the alias applies) and fails the build if the service worker would precache a file the server refuses. A new asset type means widening that one rule (`ops/README.md`, root).
- `?demo=1` seeds data only in development and the e2e build.
