# Shipping, deploy and live checks

Read before squashing onto `main`, deploying, adding a static asset type, touching the app shell or service worker, or checking the live app. README.md "Deploy and rollback" describes what `ops/deploy.sh` checks; this file holds the traps.

## Squashing onto main

- Fetch and merge the newest `origin/main` into the branch first. `git reset --soft origin/main` after a stale merge silently reverts commits that landed meanwhile; compare `git diff --stat HEAD~1 HEAD` with the other commits' files before pushing.
- Right before `git reset --soft origin/main`, hard-gate on `git merge-base --is-ancestor origin/main HEAD || exit 1`. `test … && echo` is not a guard: under `set -e` a failing command on the left of `&&` does not abort.

## Deploying

- `ops/deploy.sh <commit>` sources `ops/lib.sh` from the checkout it is run from (`~/src/gym-log`); the release it builds with `git archive` never updates those scripts. Fast-forward that checkout first (`git fetch && git merge --ff-only origin/main`, keeping untracked files), or the deploy runs an old health check.
- Never build, install or run dev servers in `~/src/gym-log` itself: it must stay a clean `main` for `ops/deploy.sh`. Work in a worktree.
- The deploy refuses commits not on `origin/main` or whose latest code commit has no successful push CI run (docs-only commits inherit their code ancestor's run; cancelled runs don't count).
- A release that adds migrations is preceded by `ops/backup.sh` plus `ops/restore-check.sh`, and a count comparison against `gym_log`. Migrations are never rolled back, and a release lacking migrations the database already has is refused.
- Undo with `ops/rollback.sh` (previous healthy release from `~/.local/share/gym-log/history`).

## Live app

- The live origin is `GYM_LOG_ORIGIN` in `~/.config/gym-log/runtime.env`. It is served by Gym Log's own tailnet device (`gym-log-tailscale.service`), so it does not appear in the host's plain `tailscale serve status`.
- Verify a deploy by comparing live `/sw.js` with `~/.local/share/gym-log/releases/<sha>/dist/sw.js`.
- Small images are inlined into the JS bundle by Vite, so a live check must compare hashes of non-inlined assets rather than grep for file names.

## Static assets and the precache

The production server sends only files allowed by `server/src/static-files.ts` (`index.html`, `sw.js`, the public shell files, and `assets/*.{js,css,woff2,webp}`). `scripts/pwa-build.ts` imports the same rule and fails the build if the service worker would precache a file the server refuses, and `ops/deploy.sh`'s health check fetches `sw.js`, the manifest and every precached URL through Serve byte for byte, rolling back and naming the file on a mismatch. A single missing file makes the service worker's `cache.addAll` fail, leaving installed apps on the old shell while the API looks healthy. A new asset type means widening that one rule. After deploys that touch the shell, still check that the service worker activates on a phone.

## Read-only live offline-shell check

Use a fresh Pixel 6 browser context and intercept only `**/api/**` with a synthetic unavailable response, so owner history and mutations stay off the wire. Avoid a catch-all `context.route('**/*')`, even with `route.continue()`: in Chrome it left the reloaded page without a service-worker controller. Wait for activation, reload under the worker, then test offline reload and reopening in a fresh tab. Never print private page text.
