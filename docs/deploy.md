# Shipping, deploy and live checks

Read before merging to `main`, deploying, adding a static asset type, touching the app shell or service worker, or checking the live app.

## Release layout

The live app runs from built releases, never from a checkout, so source can be edited and built freely. It runs as the `ember` service account (`docs/operations.md`), so every `~` below is that account's home. The `ember.service` user unit (`ops/systemd/`, installed with `ops/install.sh`) serves `~/.local/share/ember/current`, a symlink to `releases/<commit>/`. Runtime settings and secrets live in `~/.config/ember/runtime.env` (mode 0600, outside the repository) with `EMBER_WEB_ROOT` set to the absolute path of `~/.local/share/ember/current/dist` (systemd does not expand `~`). The app has its own tailnet device, `ember`, run by the `ember-tailscale.service` user unit (userspace networking, UDP 41642, state in `~/.local/share/ember-tailscale`); its Tailscale Serve config proxies HTTPS 443 to the service on loopback, so the app has its own origin. `EMBER_ORIGIN` must be that address.

## What `ops/deploy.sh` checks

- It builds `apps/web` and `apps/api` from a `git archive` export of the commit and keeps only what runs, in the release layout `ember.service` and `EMBER_WEB_ROOT` expect: the web shell in `dist/` and the compiled API with its production dependencies in `server/`. Then it switches `current` atomically and restarts the unit.
- After the switch it checks that the unit's own process owns the port, `/api/v1/health` on loopback (waiting up to two minutes for startup migrations) and through Serve, and that Serve returns this release's `index.html`, `sw.js`, `manifest.webmanifest` and every precached file byte for byte. Any failure rolls back automatically and alerts the owner.
- A lock prevents overlapping deploys and rollbacks. `ops/auto-deploy.sh` holds it for its whole run and `ops/deploy.sh` reuses it, so a rollback started meanwhile refuses with "another deploy or rollback is running"; run it again once the timer's run ends. The newest five releases are kept, and `history` records healthy deploys for rollback.
- The server applies migrations on startup. When a release adds migrations, the deploy first runs `ops/backup.sh` into `~/.local/share/ember-backups/`, restores it into a validation database, compares record and migration counts with `ember` and drops the copy; any failure cancels the deploy. Writes between the backup and the restart are not in it. The newest three pre-deploy backups are kept; manual archives there are never rotated.
- `ops/test-release-switch.sh` exercises the switch, health check and rollback against synthetic releases and a throwaway unit; it needs systemd and is local-only.

## Shipping through a PR

- Every change reaches `main` through a PR; the `main` ruleset refuses direct pushes, force pushes and deletion, and requires the `CI` check (`docs/ci-and-tests.md`). Work on a short-lived branch, push it and open a PR whose description is one to three plain sentences on what it changes and why.
- Merge with `gh pr merge <n> --squash --auto --match-head-commit <sha>`, where `<sha>` is the head you verified and had reviewed: GitHub squashes once `CI` passes on that exact head (the repository allows auto-merge and squash merges only) and refuses if the branch moved meanwhile. Merging is shipping.
- If `main` moved after the PR's CI ran, merge `origin/main` into the branch (never force-push a pushed branch) and let CI run on the new head.

## Deploying

- Main deploys itself. `ember-auto-deploy.timer` (installed and started by `ops/install.sh`) runs `ops/auto-deploy.sh` five minutes after each run ends. Once CI has passed for the head of `origin/main`, it fast-forwards `~/src/ember` and runs `ops/deploy.sh` on it. While CI is pending or GitHub is unreachable, it waits for the next run. The account reads GitHub with its own read-only token; if that token expires, every run waits, so the timer log shows "could not read CI results" until it is replaced.
- A head commit whose CI fails, whose deploy fails, or which `~/src/ember` cannot fast-forward to (not on `main`) is held in `~/.local/share/ember/auto-deploy.hold`: the owner is alerted once and it is never retried. A commit is held while it deploys too, so a run killed by the unit's 30-minute timeout is not retried (systemd's failure alert reports it); `ops/deploy.sh` exits 69 when GitHub is unreachable or CI is still running, which the timer retries instead. `ops/rollback.sh` holds main's head, so the timer does not put it straight back, however many rollbacks follow. The next commit on main replaces the hold; to retry a held commit, run `ops/deploy.sh <commit>` by hand as the service account (`docs/operations.md`). A failed health check alerts twice: once from the rollback, once from the hold.
- Merging is shipping: a merged PR is live within about five minutes after `main`'s push CI passes, plus build time. Still check the live app after each change ships.
- `ops/test-auto-deploy.sh` checks those decisions, and the alert route, against a throwaway git origin, a fake `gh`, `hermes` and `curl` and a stub deploy; it is local-only.
- `ops/deploy.sh <commit>` sources `ops/lib.sh` from the checkout it is run from (the service account's `~/src/ember`); the release it builds with `git archive` never updates those scripts. Fast-forward that checkout first (`git fetch && git merge --ff-only origin/main`, keeping untracked files), or the deploy runs an old health check.
- Never build, install or run dev servers in either `~/src/ember`: the service account's must stay a clean `main` for `ops/deploy.sh`, and the owner's is the base for worktrees.
- The deploy refuses commits not on `origin/main` or whose latest code commit has no successful push CI run (a docs-only commit inherits its code ancestor's run without waiting for its own; cancelled runs don't count).
- A release that adds migrations is preceded by `ops/backup.sh` plus `ops/restore-check.sh`, and a count comparison against `ember`. Migrations are never rolled back, and a release lacking migrations the database already has is refused.
- Undo with `ops/rollback.sh` (previous healthy release from `~/.local/share/ember/history`).

## Live app

- The live origin is `EMBER_ORIGIN` in `~/.config/ember/runtime.env`. It is served by Ember's own tailnet device (`ember-tailscale.service`), so it does not appear in the host's plain `tailscale serve status`.
- Verify a deploy by comparing live `/sw.js` with `~/.local/share/ember/releases/<sha>/dist/sw.js`.
- The server gzips responses only for clients that send `Accept-Encoding` (never Range requests). The plain-`curl` health check sends none, so its byte-for-byte comparisons still see the uncompressed files.
- Small images are inlined into the JS bundle by Vite, so a live check must compare hashes of non-inlined assets rather than grep for file names.

## Static assets and the precache

The production server sends only files allowed by `apps/api/src/static-files.ts` (`index.html`, `sw.js`, the public shell files, and `assets/*.{js,css,woff2,webp}`). `apps/web/scripts/pwa-build.ts` imports the same rule and fails the build if the service worker would precache a file the server refuses, and `ops/deploy.sh`'s health check fetches `sw.js`, the manifest and every precached URL through Serve byte for byte, rolling back and naming the file on a mismatch. A single missing file makes the service worker's `cache.addAll` fail, leaving installed apps on the old shell while the API looks healthy. A new asset type means widening that one rule. After deploys that touch the shell, still check that the service worker activates on a phone.

## Read-only live offline-shell check

Use a fresh Pixel 6 browser context and intercept only `**/api/**` with a synthetic unavailable response, so owner history and mutations stay off the wire. Avoid a catch-all `context.route('**/*')`, even with `route.continue()`: in Chrome it left the reloaded page without a service-worker controller. Wait for activation, reload under the worker, then test offline reload and reopening in a fresh tab. Never print private page text.
