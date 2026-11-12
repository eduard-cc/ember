# Ember web agent instructions

The React PWA: React 19 + TypeScript, Vite, Tailwind v4 with shadcn-style Radix wrappers, Dexie for local storage, Vitest and Playwright. Paths below are relative to `apps/web` unless they start at the repository root. Repo-wide rules (product direction, analytics invariants, production data, privacy, writing tests) are in the root `AGENTS.md`.

## Read before touching

- UI, layout, accessibility, phone gestures, installed PWA: `docs/phone-and-pwa.md` (root) and `DESIGN.md`.
- Local storage, sync client, recovery, history editing: `docs/sync-and-history.md` (root).
- Catalog data and drawings: `scripts/catalog/README.md` and `docs/catalog-drawings.md` (root). Never hand-edit `src/catalog/exercises.json`; change the inputs and run the scripts.
- Playwright, ports, flaky or killed runs: `docs/ci-and-tests.md` (root).

## Layout

- Metrics and analytics are pure functions in `src/domain/`, separate from UI and state.
- `shared/` holds the document schemas (workouts, templates, body weight, operations, backups) used by the app and its tests. The API validates the same documents with its own schemas (`apps/api/src/sync/schema.ts`); its date-contract test parses its feed with `shared/contracts.ts`, so change both together.
- `tests/`: Vitest unit tests at the top level, Playwright suites in `tests/e2e/` and `tests/pwa/`, and the local-only `tests/integration/`.
- `scripts/`: the exercise catalog pipeline, the integration harness and the PWA build (`scripts/pwa-build.ts`).

## Commands

- Setup: `npm ci --include=dev` here and in `apps/api` (unit tests and the PWA build import API modules; the integration harness loads the API's `pg`, `argon2` and `dotenv`).
- Checks: `npm run format:check` (Prettier over the whole repository), `lint:check`, `typecheck`, `build`, `test:run`, `test:e2e`, `test:pwa`, `test:integration`. `format` and `lint` rewrite files.
- `test:integration` needs the git-ignored `apps/api/.env` pointing at `ember_dev` (`docs/ci-and-tests.md`); it is not in CI.

## Traps

- Playwright `test:e2e` builds into `dist-e2e/` and previews on 5188; tests tagged `@dev-server` run on a dev server on 5189, because only it serves `/src/...` modules. Tag every test that imports or routes source modules, or it passes without testing anything.
- `test:pwa` builds `dist/` and previews on 5193, and its lifecycle tests rewrite `dist/sw.js`: never run it alongside another suite that uses that build.
- `scripts/pwa-build.ts` imports the API's static-file rule (`apps/api/src/static-files.ts`) and fails the build if the service worker would precache a file the server refuses. A new asset type means widening that one rule (`docs/deploy.md`).
- `?demo=1` seeds data only in development and the e2e build.
