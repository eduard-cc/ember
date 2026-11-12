# CI and local test runs

Read when a local test chain fails or dies mid-run, a port is busy, CI shows a flake, timeout or `cancelled`, or when writing a Playwright test.

## What runs where

- `npm run test:run`, `test:e2e`, `test:integration`, `test:pwa` and `npm --prefix server run test:e2e` all go through `ops/limited.sh`, which runs them in `ember-jobs.slice`. Without the installed slice (`ops/install.sh`) or a user systemd session it exits with an error instead of running uncapped. Under `CI=true` it runs the command directly.
- CI (`.github/workflows/ci.yml`) has three jobs: `checks` (format, lint, typecheck, unit, build), `server-e2e` (`server/test/*.e2e.test.ts` against a disposable PostgreSQL service) and `playwright` (`test:e2e`, then `test:pwa`). The `playwright` job skips both browser suites, still reporting success, when every file changed since the last green main run (or a PR's base) is in `server/`, `ops/`, `tests/integration/`, `scripts/integration.mjs` or Markdown, except `server/src/static-files.ts` and `ops/limited.sh`, which the browser suites load; `ops/browser-tests-needed.sh` decides. Ember is phone-only, so Playwright has two phone-sized (390×844) projects: `mobile` against the e2e build and `mobile-dev-server` for tests tagged `@dev-server` (see Ports). Run both: `--project=mobile` alone skips the tagged tests. Tests that need Pixel 6 or other phone sizes set them. The root `tests/integration` suite (`npm run test:integration`) is **not** in CI: run it locally whenever sync, imported history or recovery is touched.
- Pushes run CI only on `main`; PRs run separately. Markdown-only (`**/*.md`) changes skip CI, so run `npm run format:check` locally before pushing docs.
- Lint configs use type-aware `typescript-eslint` and React hooks rules for the web app, `typescript-eslint` recommended for the server; each rule turned off or narrowed carries a one-line reason in the config.
- Integration harnesses generate synthetic credentials in memory, refuse any admin database other than `ember_dev`, and refuse occupied test ports rather than reusing or killing unrelated processes.
- PWA reports (`playwright-pwa-report/`, `test-results/pwa/`) are separate from normal E2E diagnostics. CI uploads reports only on failure, with three-day retention. CI does not replace physical Android/iPhone testing.

## Keeping CI lean

Linux runners only; superseded runs are cancelled; Markdown-only changes skip CI; dependencies and browsers are cached; every job has a timeout; reports are uploaded only on failure, with short retention. Every job repeats checkout and setup, which is why cheap checks share one job. Measure a change to CI from real job start and completion timestamps, not wall time.

## Ports

- Playwright e2e builds the app in `e2e` mode into `dist-e2e/` (a production build that keeps the `?demo=1` entry; service workers are blocked, since `test:pwa` covers them) and previews it on its own strict-port server on `EMBER_E2E_PORT` (default 5188, `reuseExistingServer: false`). Tests tagged `@dev-server` run against a Vite dev server on the next port (5189) instead: only the dev server serves source modules by URL, which those tests import (`/src/storage/repository.ts`) or patch with `page.route('**/src/...')`. A test that is timing-sensitive on the build may also carry the tag, with a comment saying why. Tag every new test that does either; against the build such an import fails and a route matches nothing, so an aborting route passes without testing anything. Never point either server at another checkout's, or the tests run the wrong source.
- `scripts/integration.mjs` always binds Vite to 5188; only the API port is configurable (`EMBER_TEST_API_PORT`, default 5190). It refuses with "Port 5188 is occupied" while another worktree's e2e or integration run holds the port. Find the owner with `ss -ltnp 'sport = :5188'` and `pstree -aps <pid>`; if it is another worktree's test run, wait for it to finish rather than killing it, then rerun only the remaining stages.
- `test:pwa` builds production and previews on 5193, serially (`workers: 1`); its lifecycle tests rewrite `dist/sw.js`, so never run it in parallel with another suite sharing that build.

## Fresh worktree setup for integration tests

`scripts/integration.mjs` loads `pg`, `argon2` and `dotenv` from the server package and reads the git-ignored `server/.env`, which must point at the isolated `ember_dev` database on 127.0.0.1:55439 (the script refuses anything else). Before starting the full check chain in a new worktree:

```sh
NODE_ENV=development npm --prefix server ci --include=dev   # else "Cannot find module 'pg'"
cp -p ~/src/ember/server/.env <worktree>/server/          # keep mode 0600
```

## Flaky or killed local runs

- Missing-element failures that move between tests on each run usually mean host load. Check `uptime`, rerun with `--workers=2`, and only debug failures that repeat.
- A chain that dies with exit 143 / `Terminated` and no failing test is usually the OOM killer (the jobs slice has `MemoryMax=4G`, see `ops/systemd/ember-jobs.slice`). Confirm with `journalctl --user --since -30min --grep='oom|Out of memory' --no-pager` and `free -h`, then rerun with `--workers=1` rather than debugging code.
- Every remaining test failing with `net::ERR_CONNECTION_REFUSED` on 5188 means the e2e web server died mid-run; under heavy host load Node has crashed with `abort: Lazy deopt after a fast API call` in the `[WebServer]` output. It is not the change under test: rerun with `--last-failed` and debug only what still fails.
- If `--workers=1` is also OOM-killed, stop retrying locally and do not raise the limits: stop task-owned previews, open a feature PR so CI runs the full suite in isolation, and merge only after its exact head is green. Main must then pass its own push CI before `ops/deploy.sh` accepts the release.

## Writing Playwright tests

- Before capturing a baseline row/card count, await the expected seeded ledger or an enabled field. `data-save='saved'` can be observed before the hydrated draft renders, giving a false zero baseline.
- Phone flows use the Pixel 6 device (`devices['Pixel 6']`); the default `mobile` project is a 390×844 viewport.

## GitHub Actions

- A Playwright job that times out inside `playwright install-deps` (apt hang on GitHub's mirror) is an infrastructure flake: rerun only the failed job, don't change code.
- `cancelled` with all tests passed: check whether the job hit `timeout-minutes` in a post step (cache save) or while still running tests after a slow `install-deps`, before suspecting a superseding push. Cancelled runs are not green, and `ops/deploy.sh` will not deploy them.
- CI Playwright settings live in `playwright.config.ts`: 4 workers, `retries: 1` with `failOnFlakyTests` (a pass on retry still fails), trace `on-first-retry`, `maxFailures: 10`. Per-test tracing cost about a quarter of the run, which is why it is retry-only.
- Before adding e2e tests, compare the job's recent duration with its `timeout-minutes` (25 for `playwright`; the `npm run test:e2e` step alone has taken 12-17 minutes, and a slow apt mirror can add 5 to `install-deps`). Test time is evenly spread, so there is no single slow test to cut. Per-page cost is why most tests run against the bundled build: keep new tests off the dev server unless they need source modules.
