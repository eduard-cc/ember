# @ember/contracts

The documents the web app and the API exchange and store: workouts with their sets, body-weight measurements, sync operations and the web app's stored state, plus the retired keys older documents may still carry and the rule for which built web files the server sends. Both apps import them, so a renamed or retyped field fails type-checking or tests in both in the same PR.

## Rules

- One definition per document. The API adds its size bounds (identifier and name lengths, exercise and set counts, revisions) on top of these schemas in `apps/api/src/sync/schema.ts`; they never move here, because the web app parses documents already stored on a device and must never newly reject them.
- A field leaving a document is added to `src/retired-keys.ts`: both apps then accept it and drop it on parse (`docs/sync-and-history.md`, "Retiring a stored field").
- `zod` is the only dependency, as a peer: each app resolves it from its own `node_modules`, so each build holds one zod. The package has no `node_modules` and no lockfile of its own.
- No Node, browser, Nest or React APIs; the code must compile under both apps' compiler settings. Node-only helpers such as the security headers stay in the API.
- One file per area, re-exported from `src/index.ts`. Relative imports end in `.js` (the package is ESM).
- `src/static-files.ts` imports nothing, so the web build's Vite config can load it by path.

## How each consumer loads it

- Web: `@ember/contracts` is an alias to `src/` (`apps/web/contracts.config.ts`, used by `vite.config.ts` and `vitest.config.ts`, and the `paths` in `apps/web/tsconfig.json`). Vite's `dedupe` and the `zod` path resolve the package's zod from `apps/web/node_modules`. Nothing to build.
- API: `npm run contracts:build` compiles `src/` with the API's TypeScript into `apps/api/contracts/` (git-ignored; CommonJS and declarations, `apps/api/tsconfig.contracts.json`). The API imports it as `#contracts` through the `imports` field of `apps/api/package.json`. Because the compiled files sit inside `apps/api`, plain Node resolution finds the API's own zod: one zod instance, and no runtime flags. A linked `file:` dependency would resolve zod from this directory instead, where there is none. That build maps `zod` to `apps/api/node_modules/zod` explicitly, so a missing zod fails it loudly. `build`, `typecheck`, `dev`, `migration` and `start:trial` run it first; after editing the package, rerun it (or restart `dev`) so a running API and the editor pick up the change.
- Docker: the image's build stage copies `packages/` next to `apps/`, and the runtime stage ships `apps/api/contracts/` as `/app/server/contracts`.

Formatting follows the repository's root `.prettierrc` and runs with the web app's `format` and `format:check`.
