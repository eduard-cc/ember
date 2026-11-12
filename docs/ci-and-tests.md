# CI and local test runs

Read when a local test chain fails or dies mid-run, a port is busy, CI shows a flake, timeout or `cancelled`, or when writing a Playwright test.

## What runs where

- Run npm scripts inside the app they belong to (`npm --prefix apps/web …`, `npm --prefix apps/api …`). The web app's `test:run`, `test:e2e`, `test:integration` and `test:pwa` and the API's `test:e2e` all go through `ops/limited.sh`, which runs them in `ember-jobs.slice`. Without the installed slice (`ops/install.sh`) or a user systemd session it exits with an error instead of running uncapped. Under `CI=true` it runs the command directly.
- Ember is designed for phones, so Playwright has two phone-sized (390×844) projects: `mobile` against the e2e build and `mobile-dev-server` for tests tagged `@dev-server` (see Ports). Run both: `--project=mobile` alone skips the tagged tests. Tests that need Pixel 6 or other phone sizes set them.
- The web app's `apps/web/tests/integration` suite (`test:integration`) is **not** in CI: run it locally whenever sync, imported history or recovery is touched.
- Each app has its own ESLint config: type-aware `typescript-eslint` and React hooks rules for the web app, `typescript-eslint` recommended for the API; each rule turned off or narrowed carries a one-line reason in the config.
- Integration harnesses generate synthetic credentials in memory, refuse any admin database other than `ember_dev`, and refuse occupied test ports rather than reusing or killing unrelated processes.
- PWA reports (`apps/web/playwright-pwa-report/`, `apps/web/test-results/pwa/`) are separate from normal E2E diagnostics. CI does not replace physical Android/iPhone testing.

## CI

Workflow: `.github/workflows/ci.yml` (`CI`). It runs for every PR and every push to `main`. A PR keeps only its newest run; every push to `main` runs to completion, because the deploy reads the push run of main's head (`docs/deploy.md`).

| Job                  | Runs                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Changes`            | Decides whether the change touches code (see below)                                                                                                        |
| `Lint & format`      | The web app's `format:check` (Prettier over the whole repository), both apps' `lint:check`; runs for every change, since Prettier also checks Markdown     |
| `Build & typecheck`  | API typecheck and build, then the web app's `build` (typecheck and web build)                                                                              |
| `Unit tests`         | The web app's `test:run`                                                                                                                                   |
| `Server E2E`         | `apps/api/test/*.e2e.test.ts` against a disposable PostgreSQL service                                                                                      |
| `Playwright (phone)` | The web app's `test:e2e`                                                                                                                                   |
| `PWA (Pixel 6)`      | The web app's `test:pwa` (production offline shell and safe updates)                                                                                       |
| `Ops checks`         | `shellcheck -x` on the host and install scripts, `ops/test-install.sh`, `ops/test-auto-deploy.sh`, `ops/test-dependency-check.sh`, `ops/test-ember-run.py` |
| `CI`                 | Needs every job; fails if any failed or was cancelled, skipped jobs pass                                                                                   |

- `CI` is the only required check (the `main` ruleset), so jobs can be renamed or added without touching the ruleset. The ruleset also requires a PR for every change to `main` and blocks force pushes and deletion; nobody bypasses it.
- A PR compares its merge commit with the base branch. A push to `main` compares with the newest `main` commit whose push run passed, so a Markdown-only commit after a red or cancelled code commit still runs every job. When the change since that base is only Markdown, every job except `Lint & format` is skipped and `CI` still passes; any other file, an empty diff or an unknown base runs everything. Jobs are gated with `if:`, never with `on: paths:`: a workflow that never runs leaves the required check pending.
- Actions are pinned by commit SHA with the version in a comment; the token is read-only (`contents: read`, plus `actions: read` for `Changes`), checkouts don't keep credentials, and no workflow uses `pull_request_target`. Workflows on PRs from outside contributors wait for approval.
- Dependencies and the Playwright browser are cached; every job has a timeout. Playwright and PWA reports are uploaded only on failure, with three-day retention.
- Dependabot (`.github/dependabot.yml`) opens weekly grouped minor/patch PRs for both npm packages and the workflow actions, after a 7-day cooldown, and never bumps `@types/node` past the `.nvmrc` major. Patch and minor PRs with green `CI` are merged by the owner's automation; majors are decided one at a time.

## Ports

- Playwright e2e builds the app in `e2e` mode into `apps/web/dist-e2e/` (a production build that keeps the `?demo=1` entry; service workers are blocked, since `test:pwa` covers them) and previews it on its own strict-port server on `EMBER_E2E_PORT` (default 5188, `reuseExistingServer: false`). Tests tagged `@dev-server` run against a Vite dev server on the next port (5189) instead: only the dev server serves source modules by URL, which those tests import (`/src/storage/repository.ts`) or patch with `page.route('**/src/...')`. A test that is timing-sensitive on the build may also carry the tag, with a comment saying why. Tag every new test that does either; against the build such an import fails and a route matches nothing, so an aborting route passes without testing anything. Never point either server at another checkout's, or the tests run the wrong source.
- `apps/web/scripts/integration.mjs` always binds Vite to 5188; only the API port is configurable (`EMBER_TEST_API_PORT`, default 5190). It refuses with "Port 5188 is occupied" while another worktree's e2e or integration run holds the port. Find the owner with `ss -ltnp 'sport = :5188'` and `pstree -aps <pid>`; if it is another worktree's test run, wait for it to finish rather than killing it, then rerun only the remaining stages.
- `test:pwa` builds production and previews on 5193, serially (`workers: 1`); its lifecycle tests rewrite `apps/web/dist/sw.js`, so never run it in parallel with another suite sharing that build.

## Fresh worktree setup for integration tests

`apps/web/scripts/integration.mjs` loads `pg`, `argon2` and `dotenv` from the API package and reads the git-ignored `apps/api/.env`, which must point at the isolated `ember_dev` database on 127.0.0.1:55439 (the script refuses anything else). Before starting the full check chain in a new worktree:

```sh
NODE_ENV=development npm --prefix apps/api ci --include=dev   # else "Cannot find module 'pg'"
cp -p <main checkout>/apps/api/.env <worktree>/apps/api/      # keep mode 0600
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

- A Playwright or PWA job that times out inside `playwright install-deps` (apt hang on GitHub's mirror) is an infrastructure flake: rerun only the failed job, don't change code.
- `cancelled` with all tests passed: check whether the job hit `timeout-minutes` in a post step (cache save) or while still running tests after a slow `install-deps`, before suspecting a superseding push. Cancelled runs are not green, and `ops/deploy.sh` will not deploy them.
- CI Playwright settings live in `playwright.config.ts`: 4 workers, `retries: 1` with `failOnFlakyTests` (a pass on retry still fails), trace `on-first-retry`, `maxFailures: 10`. Per-test tracing cost about a quarter of the run, which is why it is retry-only.
- A test that passes only on retry fails the job. Fix the wait, don't raise retries: for example, a menu opened by a click takes focus asynchronously, so assert that its first item is focused before pressing Escape.
- Before adding e2e tests, compare `Playwright (phone)`'s recent duration with its `timeout-minutes`. Test time is evenly spread, so there is no single slow test to cut. Per-page cost is why most tests run against the bundled build: keep new tests off the dev server unless they need source modules.
