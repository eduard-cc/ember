# Ember agent context

Rules and non-obvious traps only. Product scope is in PRODUCT.md, the visual system in DESIGN.md, setup and commands in README.md, operations in `docs/`; derive everything else from the code.

## Read before touching

- CI, local test runs, ports, Playwright: `docs/ci-and-tests.md`
- Squash, deploy, rollback, live checks, static assets and the precache: `docs/deploy.md`
- Backups, restore drills, Docker daemon, PostgreSQL pin, slices: `docs/operations.md`
- Sync feed, outbox, local storage, recovery, history editing and aggregates: `docs/sync-and-history.md`
- UI, layout, accessibility, phone gestures, installed PWA: `docs/phone-and-pwa.md`
- Catalog drawings (licensed and AI-assisted): `docs/catalog-drawings.md`

## Product rules

Ember (formerly Gym Log) is a personal-use-first, self-hosted workout tracker inspired by Strong's logging workflow; not a branded Strong clone or an AI coach. Strong informs generic workflows, not exact branded UI or assets. Ember is the owner's source of truth for workout history; Strong is retired and its history was imported once.

- Training splits change: never encode a fixed program.
- Repeating a workout prefills editable targets; every set stays uncompleted until explicitly confirmed.
- Workouts use existing catalog or recorded exercises only; no custom-exercise creation. Reject adding or replacing with an exercise already in that workout, with a clear message. Keep exercise variants distinct and preserve imported repeated blocks.
- Dumbbell weight is per dumbbell; barbell weight includes the bar; assisted pull-up/dip load means assistance.
- PRODUCT.md's exclusions (rest timers, alerts, nutrition, social, watch, etc.) hold unless the owner changes them. Do not promise native ongoing-service behavior from web notifications.

## Analytics invariants

Lead with reps at the same weight and weight at comparable reps. Show complete exercise history, rep-specific records, per-session volume and set counts, estimated-strength trends, and workouts per week. Every trend must expose source sets. Volume is recorded load times reps, not proof of strength or hypertrophy. Estimated 1RM is secondary, formula-labelled, bounded to low-repetition resistance sets; lack of effort data prevents claims of true maximum strength. Never apply resistance formulas to assistance, unweighted work, or duration/distance. Machine weights can differ between gyms: keep recorded-load trends without equating different machines or inventing adjustments. Imported history keeps its raw values; bad data was fixed once during the import, with the owner's approval. Never add in-app flagging, exclusion or data-cleanup controls. Never silently discard repeated sets or auto-merge exercise names.

## Privacy

Personal workout history, exports and backups stay outside tracked source, public assets, build output, CI, screenshots intended for publication, and external services. Use synthetic fixtures in committed work. No telemetry or cloud processing. Imported sets keep their original source cells (`original`); never rewrite them.

## Architecture rules

- Keep metrics in pure domain functions, separate from UI/state. Do not add Redis, queues or email infrastructure without an actual need.
- Development and tests use only the owner's `ember-postgres` container (127.0.0.1:55439: `ember_dev`, plus per-run test databases) and the API on 127.0.0.1:5190. Production is the `ember` database in the separate `ember` account's daemon on 127.0.0.1:55438, served on port 5191; never point development or tests at it.
- The API stays loopback-only behind Tailscale Serve, which strips spoofed identity headers. Production auth is the exact owner's Tailscale identity; never enable Funnel or accept arbitrary tailnet users.
- Active workouts never enter server sync. Revision conflicts stay visible and retained; never silently overwrite peer data.
- Never reload an active logger silently: shell updates need explicit confirmation and a saved, draft-free transition.
- Never build in or serve from a checkout. The owner's `~/src/ember` stays a clean `main`: the base for worktrees and what the owner's monthly checks read. Deploys no longer update it, so fast-forward it after merging. The live checkout is `/home/ember/src/ember`; its builds and releases stay in that account.
- Run every live command through `sudo /usr/local/sbin/ember-run -- <command>` (e.g. `sudo /usr/local/sbin/ember-run -- bash -c 'cd ~/src/ember && ops/deploy.sh <sha>'`), which enters the account's protected manager before dropping to `ember`. Never use `systemd-run`/`systemctl` with `-M ember@` or plain `sudo -u ember`: both run outside that namespace and expose host sockets. Never run the account's files or repository scripts as the owner or root; owner maintenance uses reviewed installed copies. Logs: `sudo journalctl _UID=$UID _SYSTEMD_USER_UNIT=ember.service`. Details in `docs/operations.md`.

## Design and delivery

DESIGN.md is the visual contract. Preserve a restrained shadcn style with Ember's own amber color scheme and gym-specific thumb-friendly controls. Hit targets at least 44px; visible keyboard focus, exact-value chart alternatives, reduced-motion support. Ember is phone-only: design, test and verify at phone sizes; the legacy desktop layouts stay in the code but get no new work.
Preserve unrelated work. Prefer tests before domain behavior; verify observable Playwright flows and typecheck/build before handoff.

## Production data

The `ember` database is production: the owner's only copy of their training history, which cannot be recreated. These rules are hard limits; autonomous ownership does not override them.

- Before any schema migration, bulk data change or data repair, take a fresh `ops/backup.sh` dump and run `ops/restore-check.sh` on it, then compare row counts before and after the change. `ops/deploy.sh` does this for every release; a manual change must do it itself.
- Destructive operations (deleting, wiping, resetting or rewriting stored history, including `resetDataset`, dropping or truncating tables, restoring over the live database) need, in this order: a fresh dump, a verified restore of that dump, and the owner's explicit approval of the exact operation. Approval of one operation does not cover another.
- Migrations are forward-only and never rolled back; a release lacking migrations the database already has is refused. Prefer additive migrations; a migration that strips or rewrites stored fields counts as a bulk data change.
- The nightly encrypted off-device backup and its restore drill must keep working. Confirm the next nightly run produced `ember.dump` after any change to the container, database name, user or daemon socket.
- Never connect development tools, tests, scratch scripts or dry runs to the `ember` database; use a disposable database.

## Autonomous ownership

The owner is the client, not a code reviewer. Hermes owns this repository end to end. It decides what to build, implements it, verifies it, pushes to `main` and deploys without asking. Treat the owner's messages as product requirements, not implementation instructions. This policy applies only to this repository.

- Delivery: work on a short-lived branch, then squash onto `main` and push. Before pushing, typecheck, unit, e2e and any relevant integration/PWA suites must pass. A separate review agent must also review the change. Fix its findings or record why each one was rejected.
- Deploy: only from a green `main`, at any time; the app's update gate never reloads an open workout. Database migrations may run at any time, subject to the Production data rules above. Every deploy needs a one-command rollback. Check the deployed app afterwards and roll back if it fails.
- CI budget: the owner's GitHub Free plan includes 2,000 Linux Actions minutes and 500 MB of artifact/package storage per month, shared by every private repository, and no money will be added. Ember may use at most 1,600 minutes a month, leaving about 400 for the other private repositories. Use Linux runners only, cancel superseded runs, skip CI for docs-only changes, cache dependencies and browsers, set job timeouts, and upload artifacts only on failure with short retention. No container images on GHCR (they count against storage). Before pushing, check month-to-date Actions usage per repository (the account's billing usage API). Above 1,600 minutes account-wide, stop triggering CI, verify locally instead, and say so in the change report. Running out blocks CI for every private repo until the month resets.
- Proactive work: Hermes may choose improvements itself, such as release gates, bugs found by using the app, or patterns in the owner's usage (analysed on this machine only). At most one self-initiated change per daily run. PRODUCT.md's exclusions hold unless the owner changes them.
- Reporting: after every shipped change, send a short changelog to the owner's Hermes app (`hermes-notify`, or the reply in the conversation the request came from): what changed and why, in one or two plain lines. Don't add an undo line; the owner knows "revert that" works, so mention undo only when it needs something unusual from the owner. "Revert that" means revert and redeploy; a revert that would delete or rewrite stored history follows the Production data rules.
- Isolation: the host is shared with other apps. Ember containers run only in Ember's own rootless Docker daemon (`ember-docker.service`); use `ops/docker.sh` for every Ember Docker command, never the root daemon or another account's. Still name Ember containers/projects explicitly; never run `docker system/volume/image prune` or unscoped `compose down -v`. Change Tailscale Serve only on Ember's own device, `tailscale --socket="$XDG_RUNTIME_DIR/ember-tailscale/tailscaled.sock" serve …`; never change the host's Serve config or run `tailscale serve reset`. Never write Hermes memory or edit skills other than ember-operator and mobile-workout-ledger. Keep the production `ember-postgres` container, the `ember` database and the `ember` account's daemon socket `/run/user/$UID/ember/docker.sock`: the nightly off-device backup depends on them, so changing any of them means changing the backup job in the same change. The owner's `/run/user/$UID/ember/docker.sock` is development-only. The live app, its daemon and database run in the capped `ember-live.slice`; npm test scripts run through `ops/limited.sh` in `ember-jobs.slice`.
- Hard limits: the repository stays private and the app is reachable only on the owner's Tailscale network: never Funnel, never other tailnet users. No spending, no new third-party services or telemetry, and no outside contact except notifications to the owner (Hermes app; Discord only as the alert fallback). Never publish personal workout history, credentials or recovery archives.

## Writing tests

- Test current behavior. Name and assert what the software does now ("saving shows a pending state, then the saved value"), never the change that led to it ("…instead of X", "no longer…", "still…"). Change history belongs in commits and PRs.
- Don't assert that removed behavior stays removed. Assert that something doesn't happen only when that is a requirement in its own right: a cancelled action writes nothing, a failed check leaves data unchanged, an unauthorized request is refused.
- One test per flow. A flow is a user journey in the UI, a request through an API endpoint, or a module's public contract. When a change adds or alters a step in an existing flow, extend that flow's test (action → pending state → result) instead of adding a test for the step. Add a separate test only for a distinct flow or outcome: a failure, a cancellation, another entry point, a different kind of input.
- Regression tests follow the same rules. Strengthen the test for the flow where the bug happened so it fails on the old code, and name it for the behavior, not the bug.

## Checks

Commands are in package.json and README.md. Before handoff: `format:check`, `lint:check` (CI runs both, also for server/), typecheck, `test:run`, `test:e2e`, plus `test:integration` / `test:pwa` when touched, and `npm --prefix server run typecheck/build/test:e2e` when server/ changed. `test:integration` is not in CI. Do not run fixed-port suites concurrently. Fixtures are synthetic and databases disposable. Do not invent successful check output; state production gaps explicitly. Remaining release gates are listed in PRODUCT.md.
