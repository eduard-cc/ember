# CI and images

Read when CI shows a flake, timeout or `cancelled`, or before changing the workflows or the image.

## CI

Workflow: `.github/workflows/ci.yml` (`CI`). It runs for every PR and every push to `main`. A PR keeps only its newest run; every push to `main` runs to completion, because the deploy reads the push run of main's head (`ops/README.md`).

| Job                  | Runs                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Changes`            | Decides whether the change touches code (see below)                                                                                                                                                                      |
| `Lint & format`      | The web app's `format:check` (Prettier over the whole repository), both apps' `lint:check`, the docs check and its tests; runs for every change, since Prettier and the docs check also cover Markdown                   |
| `Build & typecheck`  | API typecheck and build, then the web app's `build` (typecheck and web build)                                                                                                                                            |
| `Unit tests`         | The web app's `test:run`                                                                                                                                                                                                 |
| `Server E2E`         | `apps/api/test/*.e2e.test.ts` against a disposable PostgreSQL service                                                                                                                                                    |
| `Playwright (phone)` | The web app's `test:e2e`                                                                                                                                                                                                 |
| `PWA (Pixel 6)`      | The web app's `test:pwa` (production offline shell and safe updates)                                                                                                                                                     |
| `Ops checks`         | `shellcheck -x` on the host, install, deploy, launcher and image scripts and their tests, `ops/test-install.sh`, `ops/test-deploy.sh`, `ops/test-auto-deploy.sh`, `ops/test-ember-run.py`, `ops/test-wait-for-deploy.py` |
| `Image`              | Builds the production image and runs `ops/image-smoke.sh` on it (see Image)                                                                                                                                              |
| `Publish image`      | Pushes to `main` only: publishes the image `Image` tested and records its digest                                                                                                                                         |
| `CI`                 | Needs every job; fails if any failed or was cancelled, skipped jobs pass                                                                                                                                                 |

- `CI` is the only required check (the `main` ruleset), so jobs can be renamed or added without touching the ruleset. The ruleset also requires a PR for every change to `main` and blocks force pushes and deletion; nobody bypasses it.
- A PR compares its merge commit with the base branch. A push to `main` compares with the newest `main` commit whose push run passed, so a Markdown-only commit after a red or cancelled code commit still runs every job. When the change since that base is only Markdown, every job except `Lint & format` is skipped and `CI` still passes; any other file (including `packages/`, which both apps build from), an empty diff or an unknown base runs everything. Jobs are gated with `if:`, never with `on: paths:`: a workflow that never runs leaves the required check pending.
- Actions are pinned by commit SHA with the version in a comment; the token is read-only (`contents: read`, plus `actions: read` for `Changes`), except that `Publish image` and the release workflow may write packages. Checkouts don't keep credentials, and no workflow uses `pull_request_target`. Workflows on PRs from outside contributors wait for approval.
- Dependencies and the Playwright browser are cached; every job has a timeout. Playwright and PWA reports are uploaded only on failure, with three-day retention.
- Dependabot (`.github/dependabot.yml`) opens weekly grouped minor/patch PRs for both npm packages and the workflow actions after a 7-day cooldown. It checks the Dockerfile's Node base image daily with no cooldown, so security releases arrive within a day, and the PostgreSQL pin in `ops/compose.local.yml` weekly, labelled `hold` (`ops/README.md`, "PostgreSQL version"). It never bumps `@types/node` or the base image past the `.nvmrc` major, and it holds back the majors the lint plugins cannot run yet (ESLint 10 for the web app, TypeScript 7), as `.github/dependabot.yml` notes. Patch and minor PRs with green `CI` and no `hold` label are merged by the owner's automation; majors are decided one at a time.

- The docs check (`.github/scripts/check-docs.mjs`; run it with `node`) fails when a living doc names a backticked path or an `npm run` script that doesn't exist, or exceeds its word budget. Budgets, the extensions that mark a path, and paths that exist only after a build or outside git live in `.github/scripts/check-docs.json`; an override or allowlisted path needs a one-line reason there. The rules are in the script's header.
- Each app has its own ESLint config: type-aware `typescript-eslint` and React hooks rules for the web app, type-aware `typescript-eslint` for the API; each rule turned off or narrowed carries a one-line reason in the config.

## Image

The root `Dockerfile` builds one image, `ghcr.io/eduard-cc/ember`: the compiled API with its production dependencies in `/app/server` and the web shell it serves in `/app/web`. It runs as the image's non-root `node` user and sets `EMBER_CONTAINER=1`, which switches the startup guard (`apps/api/src/config.ts`) to the container endpoints: it then accepts only `EMBER_HOST=0.0.0.0` and a database at `ember-postgres:5432` named `ember` or `ember_*`. Outside the image the loopback rules apply unchanged. The `.dockerignore` allowlist sends only the two apps' and the shared package's sources, without `node_modules`, build or test output and env files.

- The Node base image is pinned by tag and digest in the first stage, and every other stage builds on it; `apps/web/tests/node-image.test.ts` checks that its major is the `.nvmrc` one.
- While building, `apps/api/scripts/image-smoke.cjs` fails the build if a dev dependency is resolvable, an env file is anywhere under `/app`, the shell, `trial.js` or the compiled contracts are missing, or a runtime dependency, the app module or the migrations fail to load.
- `ops/image-smoke.sh <image>` then runs it with synthetic settings: a throwaway PostgreSQL on an internal network under the alias `ember-postgres`, the app read-only, without capabilities and not as root, `/api/v1/health` answering 200 after migrations, and `index.html`, `sw.js`, the manifest and every precached file served byte for byte as `docker cp` copies them out of the image. It also checks the image runs the pinned Node version. Locally it runs in Ember's own rootless daemon (build with `ops/docker.sh build -t ember-image:local .`).
- PRs build and smoke-test only. They never log in to a registry, so no PR image exists to deploy.
- A push to `main` that changed code hands the tested image to `Publish image` as a three-day run artifact. That job, the only one in `CI` that can write packages, checks it is the image `Image` tested, pushes it as `:sha-<commit>` with the `org.opencontainers.image.source` and `.revision` labels, and writes `ghcr.io/eduard-cc/ember@sha256:<digest> <commit>` to the `ember-image` artifact (90 days) and the run summary. A failed push fails `CI`. A full re-run rebuilds and repoints the tag; each run's record pins its own digest. The build step keeps the event payload out of the log and uploads no build record.
- `.github/workflows/release-image.yml` runs when a `main` push run of `CI` passes and retags that commit's `:sha-` image as `:main` without rebuilding. It skips commits that published no image and commits with a newer code change on `main` after them, so `:main` never moves back. It is a separate workflow so its result never changes the `CI` run deploys read. Nothing deploys from `:main`; deploys pin the digest.
- The package must be public: hosts pull by digest without credentials. GHCR creates a new package private, so its visibility is set once in the package settings.

## GHCR retention

`.github/workflows/ghcr-retention.yml` runs `ops/ghcr-retention.sh` weekly and lists the versions it would delete. It is a dry run only: the workflow never passes `--delete` and its token can only read packages. It keeps `:main`, the `sha-` images of the newest five `main` commits that published one, versions younger than 30 days, and every manifest a kept version references.

## GitHub Actions

- A Playwright or PWA job that times out inside `playwright install-deps` (apt hang on GitHub's mirror) is an infrastructure flake: rerun only the failed job, don't change code.
- `cancelled` with all tests passed: check whether the job hit `timeout-minutes` in a post step (cache save) or while still running tests after a slow `install-deps`, before suspecting a superseding push. Cancelled runs are not green, and `ops/deploy.sh` will not deploy them.
