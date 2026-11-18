# Ember agent instructions

Rules and traps the code doesn't show. Each app's `AGENTS.md`, `packages/contracts/README.md` and `ops/README.md` hold the rest.

## Working here

- `packages/contracts` holds the schemas both apps import: a change there is a change to both, and ships as one PR. CI and the production image: `docs/ci-and-images.md`.
- Run npm inside each app (`npm --prefix apps/web …`); each has its own lockfile. Prettier runs once, from `apps/web`, over the whole repository.
- Product rules: `apps/web/PRODUCT.md`; the visual contract: `apps/web/DESIGN.md`. Design, test and verify at phone sizes only.
- Commit messages follow Conventional Commits (`feat(catalog): …`, `docs: …`).
- Before handoff: `npm --prefix apps/web run format:check`, then the checks the touched app's `AGENTS.md` lists (both apps' for `packages/contracts`). Run the local-only `test:integration` whenever sync, imported history or recovery is touched.

## Host and live app

- Development and tests use only the development `ember-postgres` on 127.0.0.1:55439 (`ember_dev` and per-run `ember_*` databases) and the API on 127.0.0.1:5190. The live database is `ember` on 127.0.0.1:55438, in the service account's own Docker daemon, served on 5191; on that port the API accepts only the `ember` database.
- The API stays loopback-only behind Tailscale Serve, which strips spoofed identity headers, and production accepts only the owner's exact Tailscale login. Never enable Funnel or accept other tailnet users (`docs/adr/0002-loopback-identity-trust.md`).
- The live app runs from built releases in a dedicated service account. Never build in or serve from a checkout, and run live commands only as `ops/README.md` and `ops/live-account.md` describe.
- Other apps share this host. Run Ember containers only in Ember's own rootless Docker daemon through `ops/docker.sh`, with explicit container and project names. Never run `docker system/volume/image prune` or an unscoped `compose down -v`. Change Tailscale Serve only on Ember's own device.

## Production data

The `ember` database holds the owner's training history, which cannot be recreated.

- Before a schema migration, bulk data change or data repair: a fresh backup, a verified restore and row counts before and after (`ops/live-account.md`).
- Destructive operations (deleting, wiping, resetting or rewriting stored history, including `resetDataset`, dropping or truncating tables, restoring over the live database) need a fresh dump, a verified restore of it, and then the owner's approval of that exact operation. Approval of one operation does not cover another.
- A data repair is a generic rule in the repository with synthetic tests. The real corrections come from a private file passed at run time, and the run fails unless each correction matches exactly one row.
- Migrations are forward-only and never rolled back: `ops/deploy.sh` refuses a release that lacks a migration the database has. Prefer additive ones; a migration that strips or rewrites stored fields is a bulk data change.
- Imported sets keep their original source cells (`original`); never rewrite them.
- Keep the names the nightly off-device backup depends on stable (`ops/README.md`, Off-device backup).
- Never connect development tools, tests, scratch scripts or dry runs to the `ember` database; use a disposable one.

## Privacy

This repository and everything attached to it (commits, PRs, comments, CI logs and artifacts) are public, and Ember holds real personal training data.

- Never put real personal data anywhere in the repository or its PRs: names, emails, locations, workout history (exercises, loads, reps, dates, durations), body weight, device models, host names, IPs, account ids or home-directory paths.
- Build fixtures from scratch with obviously fake values (`owner@example.test`, `example.ts.net`, round numbers, "Synthetic" names); never copy an export, a dump or a production row. Refer to production rows by id only.
- Personal history, exports, backups, credentials and personal screenshots stay out of tracked source, `apps/web/public/`, build output, CI and external services. No telemetry and no cloud processing of workout data.
- If you find real personal data, stop and tell the owner instead of fixing it in a PR: the diff would publish it again.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Docs

Living docs (`README.md`, `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `docs/` folders, `ops/*.md`) state current durable facts: no dates, history or rename narration. CI checks their paths, npm scripts and word budgets (`.github/scripts/check-docs.mjs`).

## Agent skills

- Issue tracker: the Linear project Ember; GitHub Issues are disabled (`docs/agents/issue-tracker.md`).
- Triage labels: the five defaults, unchanged (`docs/agents/triage-labels.md`).
- Domain docs: single-context, with decisions in `docs/adr/` and a root `GLOSSARY.md` once the first term is resolved (`docs/agents/domain.md`).
