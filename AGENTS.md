# Ember agent instructions

Ember is a self-hosted, local-first workout tracker for phones: a React PWA (`apps/web`) with a NestJS and PostgreSQL sync API (`apps/api`). Rules and non-obvious traps only; derive everything else from the code.

## Layout and workflow

- Before touching an app, read its `AGENTS.md` (`apps/web`, `apps/api`) and the docs it lists; for `packages/contracts` and `ops`, read their `README.md`. `packages/contracts` holds the schemas both apps import: a change there is a change to both. CI and the production image: `docs/ci-and-images.md`.
- Run npm inside each app (`npm --prefix apps/web …`); each has its own lockfile and ESLint config. `packages/contracts` has no node_modules or lockfile: zod resolves from each app. Prettier runs once from `apps/web` over the whole repository.
- Product rules and exclusions: `apps/web/PRODUCT.md`; the visual contract: `apps/web/DESIGN.md`. Design, test and verify at phone sizes only.
- Every change goes through a short-lived branch and a PR (`ops/README.md`, also for deploys and live checks); merging to `main` ships. Conventional Commit messages. A change touching both apps is one PR. Preserve unrelated work.

## Analytics invariants

Lead with reps at the same weight and weight at comparable reps. Show complete exercise history, rep-specific records, per-session volume and set counts, estimated-strength trends, and workouts per week. Every trend must expose source sets. Volume is recorded load times reps, not proof of strength or hypertrophy. Estimated 1RM is secondary, formula-labelled, bounded to low-repetition resistance sets; lack of effort data prevents claims of true maximum strength. Never apply resistance formulas to assistance, unweighted work, or duration/distance. Machine loads are not comparable across machines: keep recorded-load trends without equating different machines or inventing adjustments. Imported history keeps its raw values; corrections happen by editing the workout. Never add in-app flagging, exclusion or data-cleanup controls. Never silently discard repeated sets or auto-merge exercise names.

## Architecture

- Development and tests use only the development `ember-postgres` container (127.0.0.1:55439: `ember_dev`, plus per-run test databases) and the API on 127.0.0.1:5190. Production is the `ember` database in the service account's own Docker daemon on 127.0.0.1:55438, served on port 5191; never point development or tests at it.
- The API stays loopback-only behind Tailscale Serve, which strips spoofed identity headers. Production auth is the owner's exact Tailscale identity; never enable Funnel or accept arbitrary tailnet users.
- Active workouts never enter server sync. Revision conflicts stay visible and retained; never silently overwrite peer data.
- Never reload an active logger silently: shell updates need explicit confirmation and a saved, draft-free transition.
- Never build in or serve from a checkout. The live app runs from built releases in a dedicated service account; run live commands only the way `ops/README.md` describes, never as another user.
- Ember shares its host with other apps. Run Ember containers only in Ember's own rootless Docker daemon, through `ops/docker.sh`; name Ember containers and projects explicitly, and never run `docker system/volume/image prune` or an unscoped `compose down -v`. Change Tailscale Serve only on Ember's own device, never the host's.

## Production data

The `ember` database is production: the owner's training history, which cannot be recreated. These rules are hard limits.

- Before any schema migration, bulk data change or data repair, take a fresh `ops/backup.sh` dump and run `ops/restore-check.sh` on it, then compare row counts before and after the change. For a release that adds migrations, `ops/deploy.sh` takes the dump, restore-checks it and compares the restored copy's record and migration counts with the live database before switching; the comparison after the migration, and every step of a manual change, are yours.
- Destructive operations (deleting, wiping, resetting or rewriting stored history, including `resetDataset`, dropping or truncating tables, restoring over the live database) need, in this order: a fresh dump, a verified restore of that dump, and the owner's explicit approval of the exact operation. Approval of one operation does not cover another.
- Migrations are forward-only and never rolled back; a release lacking migrations the database already has is refused. Prefer additive migrations; a migration that strips or rewrites stored fields counts as a bulk data change.
- Imported sets keep their original source cells (`original`); never rewrite them.
- A nightly encrypted off-device backup dumps the live database through the service account's Docker socket. Keep the `ember-postgres` container, the `ember` database and user, and that socket stable; a change to any of them needs the backup job changed with it and the next nightly dump confirmed.
- Never connect development tools, tests, scratch scripts or dry runs to the `ember` database; use a disposable database.

## Privacy

This repository and everything attached to it (commits, PRs, comments, issues, CI logs and artifacts) are public. Ember holds real personal training data, so none of it may appear there.

- Never put real personal data in code, tests, fixtures, docs, commits, PR descriptions or comments: names, emails, locations, workout history (exercises done, loads, reps, dates, durations), body weight, device models, host names, IPs, account ids or home-directory paths.
- Use obviously fake values: `owner@example.test`, `example.ts.net`, workouts and body-weight entries built from scratch with round numbers and "Synthetic" names.
- Build fixtures from scratch; never copy an export, a dump or a production row. Refer to production rows by id only.
- Personal history, exports, backups, credentials and personal screenshots stay out of tracked source, `apps/web/public/`, build output, CI and external services. No telemetry or cloud processing of workout data.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Verification

- Before handoff: `npm --prefix apps/web run format:check`, then the checks the touched app's `AGENTS.md` lists (both apps' for `packages/contracts`). Run the local-only `test:integration` whenever sync, imported history or recovery is touched.
- Write the test before domain behavior.
- Fixed-port test suites are shared by every worktree: never run them concurrently (`apps/web/docs/testing.md`).
- Never invent successful check output; state production gaps explicitly.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Docs

Living docs (`README.md`, `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `docs/` folders) state current durable facts: no dates, history or rename narration. Edit Markdown by hand.
