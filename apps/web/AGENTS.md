# Ember web agent instructions

Paths are relative to `apps/web` unless they start at the repository root.

## Read before touching

- `PRODUCT.md`: product scope, exclusions and release gates; `docs/product-decisions.md`: naming, watch integration and copy rules.
- UI, layout, accessibility, phone gestures, installed PWA: `DESIGN.md` and `docs/phone-and-pwa.md`.
- Local storage, sync client, recovery, history editing: `docs/sync-and-history.md`; sync protocol rules: `packages/contracts/README.md` (root).
- Catalog data and drawings: `docs/catalog.md`. Never hand-edit `src/catalog/exercises.json`; change the inputs and run the scripts.
- Playwright, ports, flaky or killed runs, writing browser tests: `docs/testing.md`.

## Commands

- Install with `npm ci --include=dev` here and in `apps/api`: a unit test imports the API's security headers, and the integration harness builds the API and loads its `pg`, `argon2` and `dotenv`.
- Checks: `npm run format:check` (Prettier over the whole repository), `lint:check`, `typecheck`, `build`, `test:run`, `test:e2e`, `test:pwa`, `test:integration`. `format` and `lint` rewrite files.
- Tag every e2e test that imports or routes source modules (`/src/...`) with `@dev-server`. Against the bundled build such an import fails and such a route matches nothing, so the test passes without testing anything.
- `?demo=1` seeds data only in development and the e2e build.

## Analytics invariants

These are product decisions; prototypes follow them too.

- Lead with reps at the same weight and weight at comparable reps. Show complete exercise history, rep-specific records, per-session volume and set counts, estimated-strength trends and workouts per week. Every trend exposes its source sets.
- Volume is recorded load times reps, not proof of strength or hypertrophy. Estimated 1RM is secondary, formula-labelled and limited to low-repetition resistance sets; without effort data, never claim true maximum strength.
- Never apply resistance formulas to assistance, unweighted work, or duration and distance. Loads on different machines are not comparable: keep recorded-load trends without equating machines or inventing adjustments.
- Imported history keeps its raw values; corrections happen by editing the workout. No in-app flagging, exclusion or data-cleanup controls. Never silently discard repeated sets or auto-merge exercise names.
