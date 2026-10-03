# Gym Log

A local-first mobile workout tracker with inspectable history, editable templates, preservation-aware Strong CSV import, and a separate privately hosted API. The name is temporary. The prototype baseline is preserved in local Git history; the current foundation is not yet an approved replacement for Strong.

## Run locally

Requires compatible Node.js/npm, Google Chrome for browser tests, and Docker for the isolated PostgreSQL/API integration checks.

```sh
npm ci --include=dev
npm --prefix server ci --include=dev
npm run dev
```

Open http://127.0.0.1:5188. An ordinary installation starts empty. `/?demo=1` is an explicit **development-only** synthetic demo; production builds ignore it. Do not synchronize demo profiles with personal history.

The local API setup and secure credential requirements are documented in `server/README.md`:

```sh
docker compose -f ops/compose.local.yml up -d --wait
docker exec gym-log-local-postgres sh -c 'createdb -U "$POSTGRES_USER" gym_log_dev'  # once
npm --prefix server run migration
npm --prefix server run dev
```

Use a separate terminal for the API. Development Vite proxies same-origin `/api/v1` requests to loopback port 5190. Development and tests use the `gym_log_dev` database in `gym-log-local` on loopback port 55439; test databases are created from it. The live private trial alone uses the `gym_log` database and port 5191, configured outside the repository; never point development at it. These are local development resources, not production deployment. No usable default owner password exists; provision an owner hash through a secure local workflow before interactive authenticated use. Do not paste credentials into chat or tracked files.

## Saving and synchronization

- **Saved on this device** means the IndexedDB transaction committed. It is not protection against clearing browser storage, uninstalling the PWA, device loss, or physical disk failure.
- An unfinished workout belongs to its starting browser installation. It is **not sent to the server**. A second same-origin tab is read-only until the writer closes and it is reloaded.
- Finishing atomically stores valid explicitly completed sets, creates an immutable pending operation and removes the draft. Write failures retain the draft and report **Not saved**.
- The private trial connects automatically using the owner's Tailscale identity, without an app password or manual sync setup. Completed history, imported history and templates synchronize while the app is open and connected. An expired session reconnects automatically.
- Offline/pending mutations survive reopening; reconnect retries use the same operation identity so a lost response does not duplicate the server write. Previously trusted installations can continue logging offline. Android does not guarantee uploads while the PWA is closed.
- **Synced** means server synchronization succeeded, not off-device disaster recovery. Rejected/conflicting operations remain visible and retained for recovery/export; there is no automatic merge UI.
- Valid legacy `gym-log:v1` localStorage data migrates transactionally, retaining original bytes. Malformed or unsupported data blocks writes; explicit reset preserves recovery evidence rather than silently overwriting it.

## Import and privacy

The UI accepts a local Strong CSV with preview and explicit replacement of imported history. Native logged workouts and the draft are preserved. Exact file bytes determine source identity; repeated rows, exercise occurrences, original cells, blank-versus-zero values and wall-time timestamps are retained. Imported and native history have distinct server operation kinds so CSV replacement cannot remove native logged workouts.

A private development input can also be made available explicitly:

```sh
GYM_LOG_CSV=/absolute/path/to/strong-export.csv npm run dev
```

Then use `/?localCsv=1`. This loopback-only development route is not present in production output, and is not service-worker cached. Do not expose the development server publicly or on the tailnet. Private CSVs, `.local/`, ignored credentials, database dumps and personal screenshots must not enter tracked source, `public/`, build artifacts or external services. Only synthetic fixtures belong in tests.

## Offline app shell

Production builds include a manifest, icons and a finite service-worker app-shell cache. After a successful initial online load, the shell can reopen offline and use IndexedDB. API responses, private CSVs, JSON payloads and arbitrary runtime requests are not cached. Updates wait instead of silently refreshing the logger; no native background-sync or Android ongoing-notification guarantee is implied.

## Recovery

Versioned JSON recovery functions and the recovery surface export domain documents, original import evidence and a local draft without credentials/session secrets. Diagnostic pending operations are labelled, not replayed as old acknowledgements. A restore validates before writing, requires explicit confirmation to replace occupied local data and rebuilds create-only operations; it does not authorize overwriting newer server revisions.

The server restore drill uses task-scoped plaintext custom-format PostgreSQL archives, excludes session data and targets only a new isolated validation database. See `ops/backup.sh`, `ops/restore-check.sh` and their real PostgreSQL test. Preserve archives privately. No backup scheduler, external destination or encryption-key recovery workflow has been configured; on-host archives do not protect against loss of this disk.

## Checks

```sh
npm run format:check
npm run test:run
npm run typecheck
npm run build
npm run test:e2e
npm run test:integration
NODE_ENV=test npx playwright test --config playwright.pwa.config.ts
NODE_ENV=test npx playwright test --config tests/recovery/playwright.config.ts
npm --prefix server run typecheck
npm --prefix server run build
npm --prefix server run test:e2e
```

Integration checks create migrated disposable databases and generate synthetic credentials in memory. They refuse occupied test ports rather than reusing or terminating unrelated processes. Test harnesses refuse any admin database other than `gym_log_dev`; the live `gym_log` database is never a fixture target. No private export is needed. Do not run two fixed-port integration harnesses concurrently.

### GitHub Actions CI

`.github/workflows/ci.yml` runs format checks, web/server typechecks and builds, unit tests, server E2E against a disposable PostgreSQL 17.6 service on `127.0.0.1:55439`, and Playwright desktop/mobile E2E. The service starts with a throwaway `gym_log_dev` database; tests create and remove their own migrated databases. All inputs are synthetic, with no host credentials or private exports.

CI uses Linux runners, the Node.js major in `.nvmrc` (matching the live service), SHA-pinned actions, npm and Playwright Chromium caches, and a timeout on every job. Cheap checks share one job because GitHub bills each job per started minute. New commits cancel superseded runs for the same branch/PR, so a cancelled `main` run is not a green one. Pushes run only on `main`; PRs run separately. Markdown-only changes and agent plans skip CI, so run `npm run format:check` locally before pushing docs. Browser reports, screenshots and traces upload only on failure and expire after three days; no build artifacts or container images are published. Local browser tests still use installed Google Chrome; `CI=true` selects Playwright's bundled Chromium and two workers without retries.

The integration, PWA and recovery suites stay **local-only** to save Actions minutes. Run them, along with the checks above and independent review, **before every code push**. Run fixed-port suites sequentially. CI does not replace real phone testing or authorize deployment by itself.

The budget is at most 1,000 Gym Log Linux runner-minutes/month, shared within the account's 2,000-minute free allowance. Before pushing, query the account's billing usage API and total month-to-date Actions minutes by repository. At 800 Gym Log minutes or 1,600 account-wide, stop triggering CI, verify locally instead, and mention the budget pause in the Discord report. The target is under 15 aggregate runner-minutes per code push, not just elapsed wall time; use the real job start/completion timestamps to measure it.

Measured: the first `main` run (3 October 2026, cold caches) took 2m50s wall time. Jobs took 44s (checks), 1m21s (server E2E) and 2m45s (Playwright), 4m50s of runner time billed as 6 minutes. That allows roughly 160 code pushes a month within the Gym Log budget.

## Mobile logger and analytics

The compact logger retains full-width exercise sections, explicit completion, large editable fields and keyboard-aware scrolling. Swipe left to **reveal** Delete, then tap it; the set-number action provides the keyboard/non-gesture alternative. Undo restores the latest deleted set without reverting later edits. It is transient within the logger view, not a persisted recovery stack.

Prefilled numbers are targets. Editing clears completion. Finish excludes uncompleted/invalid sets. Historical comparison links expose actual source sets. Chromium touch/viewport tests do not prove comfort on the real phone keyboard; on-device validation is still required.

Weight is normalized to kg and distance to km while retaining source values. Epley estimates apply only to weighted sets of 2–10 reps; a single rep uses recorded load. Assistance/unweighted/duration work does not use resistance estimates. Recorded machine weights are not equated across equipment changes.

## Remaining release gates

Real phone installation/workout testing, off-device encrypted recovery and automated backups are not completed. The private mobile trial uses Tailscale Serve and owner identity authentication; it is not a complete production release. CI/CD and deployment are owned by Hermes (see AGENTS.md). Nearby-weight fallback, suspicious-set correction/exclusion UI, comprehensive exercise instructions/catalog, optional bodyweight tracking and broader cardio workflows remain separate product work.

`PRODUCT.md` describes product scope; `DESIGN.md` describes the built visual system. Repository guidance remains in `AGENTS.md`. Source is maintained in a private GitHub repository. Personal history, credentials and recovery archives remain excluded.
