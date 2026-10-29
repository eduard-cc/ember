# CI and local test runs

Read when a local test chain fails or dies mid-run, a port is busy, CI shows a flake, timeout or `cancelled`, or when writing a Playwright test. The CI budget rules live in AGENTS.md.

## What runs where

- `npm run test:run`, `test:e2e`, `test:integration`, `test:pwa` and `npm --prefix server run test:e2e` all go through `ops/limited.sh`, which runs them in `ember-jobs.slice`. Without the installed slice (`ops/install.sh`) or a user systemd session it exits with an error instead of running uncapped. Under `CI=true` it runs the command directly.
- CI (`.github/workflows/ci.yml`) has three jobs: `checks` (format, lint, typecheck, unit, build), `server-e2e` (`server/test/*.e2e.test.ts` against a disposable PostgreSQL service) and `playwright` (`test:e2e`, then `test:pwa`). The root `tests/integration` suite (`npm run test:integration`) is **not** in CI: run it locally whenever sync, import or recovery is touched.
- Pushes run CI only on `main`; PRs run separately. Paths `**/*.md` and `.hermes/**` skip CI, so run `npm run format:check` locally before pushing docs.

## Ports

- Playwright e2e starts its own strict-port Vite server on `EMBER_E2E_PORT` (default 5188, `reuseExistingServer: false`). Never point it at another checkout's dev server, or the tests run the wrong source.
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
- If `--workers=1` is also OOM-killed, stop retrying locally and do not raise the limits: stop task-owned previews, open a feature PR so CI runs the full suite in isolation, and merge only after its exact head is green. Main must then pass its own push CI before `ops/deploy.sh` accepts the release.

## Writing Playwright tests

- Before capturing a baseline row/card count, await the expected seeded ledger or an enabled field. `data-save='saved'` can be observed before the hydrated draft renders, giving a false zero baseline.
- Phone flows use the Pixel 6 device (`devices['Pixel 6']`); the default `mobile` project is a 390×844 viewport.

## GitHub Actions

- A Playwright job that times out inside `playwright install-deps` (apt hang on GitHub's mirror) is an infrastructure flake: rerun only the failed job, don't change code.
- `cancelled` with all tests passed: check whether the job hit `timeout-minutes` in a post step (cache save) before suspecting a superseding push. Cancelled runs are not green, and `ops/deploy.sh` will not deploy them.
- CI Playwright settings live in `playwright.config.ts`: 4 workers, `retries: 1` with `failOnFlakyTests` (a pass on retry still fails), trace `on-first-retry`, `maxFailures: 10`. Per-test tracing cost about a quarter of the run, which is why it is retry-only.
- Before adding e2e tests, compare the job's recent duration with its `timeout-minutes` (20 for `playwright`). Test time is evenly spread, so there is no single slow test to cut; the next lever is per-page cost: each dev-server page load fetches every catalog image module through the eager `import.meta.glob` in `src/catalog/catalog.ts`.
