# Ember operations

Read before merging, deploying, adding a static asset type, touching the shell or service worker, checking the live app, or touching backups, the database, the Docker daemon, units, slices or anything else shared with the host. The Production data rules in the root `AGENTS.md` are hard limits on top of this. Each script's header says what it does; `ops/test-*.sh`, `ops/test-ember-run.py` and `ops/test-wait-for-deploy.py` are synthetic checks, and CI runs all but `ops/test-release-switch.sh`, which needs a systemd user session (`docs/ci-and-images.md`).

## Releases and deploy

### Release layout

The live app runs from releases, never from a checkout, as the `ember` service account (Service account below); every `~` below is that account's home. The release layout under `~/.local/share/ember` is in `ops/lib.sh`'s header. `ember.service` runs `current` as the `ember-app` container in Ember's own Docker daemon, published on `127.0.0.1` only, through `~/.local/lib/ember/start.sh`, the copy of `ops/start.sh` that `ops/install.sh` installs (its header says what it passes and refuses), so advancing the checkout never changes what the unit runs. The daemon never pulls at start. The account has no Node; the app runs on the image's. Releases without `IMAGE` cannot run, and `ops/rollback.sh` skips them.

Runtime settings and secrets live in `~/.config/ember/runtime.env` (mode 0600). The app has its own tailnet device, `ember`, run by `ember-tailscale.service` (userspace networking, state in `~/.local/share/ember-tailscale`); its Tailscale Serve config proxies HTTPS 443 to the service on loopback. `EMBER_ORIGIN` must be that address.

### What `ops/deploy.sh` checks

- It deploys the image CI tested and published for the commit's code, never a build of its own. It reads the `ember-image` record of the newest green push run of that code that published an image (a docs-only commit uses its code commit's image) and refuses unless it is exactly `ghcr.io/eduard-cc/ember@sha256:<digest> <commit>` naming that run's own commit. It pulls that digest, never a tag, and refuses unless the image's `revision` label is that commit and its `source` label this repository.
- Before the switch it checks that the installed launcher matches the checkout's `ops/start.sh` and that `ember.service` runs it; after a change to either, run `ops/install.sh` in the account first, or every deploy refuses with "run ops/install.sh".
- After the switch it checks that the serving release owns the port, `/api/v1/health` answers on loopback and through Serve, and Serve returns this release's shell and every precached file byte for byte (`ops/lib.sh`). Any failure rolls back automatically and alerts the owner.
- A lock prevents overlapping deploys and rollbacks. `ops/auto-deploy.sh` holds it for its whole run and `ops/deploy.sh` reuses it, so a rollback started meanwhile refuses with "another deploy or rollback is running"; run it again once the timer's run ends.
- Kept releases keep their images, so rollback never needs the registry; other images of this repository are removed by digest, never a prune.
- When a release adds migrations (listed by that release's own code in a container without network), the deploy first runs `ops/backup.sh` into `~/.local/share/ember-backups/`, restores it into a validation database, compares record and migration counts with `ember` and drops the copy; any failure cancels the deploy. Writes between the backup and the restart are not in it. Manual archives there are never rotated.

### Shipping through a PR

- Every change reaches `main` through a PR; the `main` ruleset refuses direct pushes, force pushes and deletion, and requires the `CI` check (`docs/ci-and-images.md`). The PR description opens with one or two short sentences on what it changes and why, adds short bullets only when the PR does several separate things, puts anything the reviewer must act on (deploy order, migration, risk) on a line starting with **Note:**, and doesn't restate what CI reports.
- Merge with `gh pr merge <n> --squash --auto --match-head-commit <sha>`, where `<sha>` is the head you verified and had reviewed: GitHub squashes once `CI` passes on that exact head and refuses if the branch moved meanwhile. Merging is shipping.
- If `main` moved after the PR's CI ran, merge `origin/main` into the branch (never force-push a pushed branch) and let CI run on the new head.

### Deploying

- Main deploys itself: `ember-auto-deploy.timer` runs `ops/auto-deploy.sh` (see its header) five minutes after each run ends. If the account's read-only GitHub token stops working, runs log "could not read CI results" (`~/.local/share/ember/github-unreachable` marks when it began).
- A head commit whose CI fails, whose deploy fails, or which `~/src/ember` cannot fast-forward to is held in `~/.local/share/ember/auto-deploy.hold`: the owner is alerted once and it is never retried. A commit is held while it deploys too, so a run killed by the unit's 30-minute timeout is not retried (systemd's failure alert reports it). `ops/deploy.sh` exits 69, which the timer retries, only when GitHub is unreachable, CI is still running, or the registry gives no answer or answers 408, 429 or 5xx for any part of a pull; it judges a failed pull by re-requesting each part, never by the error text, and any other failure (a bad image record, an image the registry refuses, wrong labels, this host's own failure) is held with one alert. To retry a held commit, run `ops/deploy.sh <commit>` by hand as the service account. A failed health check alerts twice: from the rollback and from the hold.
- A merged PR is live minutes after `main`'s push CI passes; still check the live app after each change ships.
- `ops/deploy.sh <commit>` sources `ops/lib.sh` from the checkout it runs from (the service account's `~/src/ember`); a release never updates those scripts. Fast-forward that checkout first (`git fetch && git merge --ff-only origin/main`, keeping untracked files), or the deploy runs an old health check.
- Never build, install or run dev servers in either `~/src/ember`: the service account's must stay a clean `main` for `ops/deploy.sh`, and the owner's is the base for worktrees.
- Undo with `ops/rollback.sh` (the previous healthy image release from `~/.local/share/ember/history`, still local, so no network needed); with no earlier image release it refuses and changes nothing. Run it as the service account: `sudo /usr/local/sbin/ember-run -- bash -c 'cd ~/src/ember && ops/rollback.sh'`. Roll forward with `ops/deploy.sh <commit>`, which reuses the kept release while it is what the deploy would make. A release in `history` or the live one is never replaced by a different one: such a deploy refuses, so a failed replacement never costs a rollback target.
- To pause deploys, stop the timer in the account (`ember-run -- systemctl --user stop ember-auto-deploy.timer`) and start it again afterwards; `ops/install.sh` starts it too. For a short manual step, hold the deploy lock on file descriptor 9 as `ops/auto-deploy.sh` does: `ember-run -- bash -c 'exec 9>~/.local/share/ember/deploy.lock && flock -n 9 && cd ~/src/ember && <commands>'`. The timer waits meanwhile, and `ops/deploy.sh` and `ops/rollback.sh` run inside it reuse the lock.

### Static assets and the precache

The production server sends only files allowed by `packages/contracts/src/static-files.ts`. `apps/web/scripts/pwa-build.ts` fails the build if the service worker would precache a file the server refuses, and the deploy's health check compares every precached URL through Serve. A single missing file makes the service worker's `cache.addAll` fail, leaving installed apps on the old shell while the API looks healthy. A new asset type means widening that one rule. After deploys that touch the shell, still check that the service worker activates on a phone.

### npm dependencies and Node

Routine updates come from Dependabot (`docs/ci-and-images.md`). A Dependabot alert still open a day after it was raised becomes a card on the owner's task board. Fix advisories with in-major updates, never `npm audit fix --force`.

## Live checks

- The live origin is `EMBER_ORIGIN` in `~/.config/ember/runtime.env`. Ember's own tailnet device serves it, so it does not appear in the host's plain `tailscale serve status`.
- Verify a deploy by comparing live `/sw.js` with `~/.local/share/ember/releases/<sha>/dist/sw.js`, and check that `ember-app` runs the digest in `releases/<sha>/IMAGE` (`ops/docker.sh inspect --format '{{.Image}}' ember-app` against `ops/docker.sh image inspect --format '{{.Id}}' <image>`). The app's log is `journalctl --user -u ember.service`.
- The server gzips only for clients that send `Accept-Encoding` (never Range requests); plain `curl` sends none, so byte-for-byte comparisons see the uncompressed files.
- Vite inlines small images into the JS bundle: compare hashes of non-inlined assets rather than grepping for file names.
- `ops/livecheck.sh` prints a read-only summary of the live app. `ops/wait-for-deploy <sha>` waits for a merged commit to go live. How to run both, read-only UI checks and changes that need backup evidence: `ops/live-account.md`.

### Crash loops

If the service crash-loops, systemd stops it and `ember-notify-failure@` alerts. Its helper is the reviewed copy of `ops/notify.sh` that `ops/install.sh` installs at `~/.local/lib/ember/notify.sh`, never a script executed from the checkout; after a notifier change, reinstall from reviewed source.

## Backups and restore drills

### Local backups

`ops/backup.sh` writes plaintext custom-format PostgreSQL archives (session data excluded) to `~/.local/share/ember-backups/`, which stays on the machine. `ops/restore-check.sh <archive> <db>` restores one into a new isolated validation database only; the row-count comparison with `ember` is the caller's. Preserve archives privately.

### Off-device backup

A nightly root-owned backup job outside this repository dumps the live `ember` database with `pg_dump -Fc` through the service account's Docker socket (`$XDG_RUNTIME_DIR/ember/docker.sock`), skipping the daemon's raw data directory, into an encrypted off-device backup. Keep the `ember-postgres` container, the `ember` database and user, and that socket stable: a change to any of them needs the backup job changed with it and the next nightly dump confirmed.

Restore drill: fetch the newest off-device dump read-only (never run `forget`, `prune` or `unlock` on the backup repository by hand), restore it with `ops/restore-check.sh <dump> <db>` as the service account into a new validation database, then compare every table with `ember`: row count and an ordered `md5` of all rows, plus the schema from `pg_dump -s`. Differences must be explained by writes after the snapshot time, typically new sessions or synced records. This dump includes the `sessions` table, so treat the validation database and the local file as secret: drop the database (`ops/docker.sh exec ember-postgres dropdb -U ember <db>`) and `shred -u` the file promptly. Repeat the drill after database changes. Recovery on a rebuilt machine is a release gate (`apps/web/PRODUCT.md`).

## Service account and Docker daemon

### Service account

The live app and everything that builds or deploys it run as the dedicated `ember` account, never as the owner: the auto-deploy, `ember.service`, Ember's Docker daemon and database, and its Tailscale device all live in that account's lingering user manager. Code from `main` and npm runs there, so treat it as untrusted:

- It has no password, no login shell and no supplementary groups (sudo, docker, lxd and adm are each a way out); its home is private, and the owner's home is closed to it.
- Unix permissions do not cover the network: every local user can reach loopback services, this host's tailnet address and Docker bridge networks. The root nftables table `ember_egress_<uid>` (`ops/host/egress.nft.in`, loaded by `ember-egress-ember.service`, which the account's `user@<uid>.service` requires) lets the account and its subordinate uids reach only the internet, DNS, its own loopback ports, the owner's alert webhook on loopback, HTTPS on its own tailnet device and nothing else on the host, LAN or tailnet.
- User-unit sandboxing (`ProtectHome=`, `IPAddressDeny=` and the like) is silently ignored on hosts that restrict unprivileged user namespaces, and the account controls its own user manager anyway. The root-owned drop-in `ops/host/user-manager.conf` (its header says what it keeps) instead gives the whole manager an inherited mount namespace hiding host IPC, which rootlesskit children cannot unmount. Setup refuses an existing crontab, so no scheduled code escapes this manager. The namespace, uid permissions and firewall together enforce the boundary.
- GitHub access is a read-only token limited to this repository, in the account's own `gh` config.
- Alerts go through `ops/notify.sh` (its header has the webhook file, queue and retry rules). The receiver passes only the alert texts the ops scripts send and replaces anything else with a fixed notice, so a new or reworded alert needs its template allowed there too. After a change to `ops/notify.sh` or the units ships, rerun `ops/install.sh` in the account: deploys do not reinstall them.
- Set it up with `ops/host/setup-account.sh` (root) and `ops/host/setup-service-user.sh` (as the account), both from a reviewed checkout. `ops/isolation-check.sh`, run as the account, shows what it can and cannot reach.

If a root-owned manager drop-in changes, stop that account's manager before rerunning setup, then start it again; setup refuses to change the namespace of an active manager. Run Ember commands in the account's own user manager, for example `sudo /usr/local/sbin/ember-run -- bash -c 'cd ~/src/ember && ops/deploy.sh <commit>'`, `sudo /usr/local/sbin/ember-run -- systemctl --user status ember.service` and `sudo journalctl _UID=$(id -u ember) _SYSTEMD_USER_UNIT=ember-auto-deploy.service`. `ember-run` is a reviewed root-owned copy installed by account setup. Never use `systemd-run` or `systemctl` with `-M ember@`: its same-uid transport runs outside that namespace and exposes host IPC through `/proc/PID/root`. Never execute app code from the account's home or checkout as the owner or as root: the account can rewrite it.

Accepted exposure: the account can read world-readable files and see other users' process command lines, and code running as it can read and change Ember's data and use the Ember tailnet device's identity, which a tailnet ACL tag limits to inbound connections from the owner's devices.

### Rootless Docker daemon

Ember runs its PostgreSQL container in its own rootless Docker daemon, `ember-docker.service` in the service account, with the socket at `$XDG_RUNTIME_DIR/ember/docker.sock` and data under `~/.local/share/ember-docker`. The live `ember` database is published on 127.0.0.1:55438 (`EMBER_PG_PORT=55438 ops/docker.sh compose -f ops/compose.local.yml up -d --wait`); the server accepts that port for the `ember` database only. Development databases stay on the owner's own daemon (root `AGENTS.md`). Use `ops/docker.sh` (the Docker CLI pointed at that socket, ignoring any exported `DOCKER_HOST`) for every Ember container command.

### PostgreSQL version

The image is pinned once, by tag and digest (`postgres:17.N-bookworm@sha256:…`), in `ops/compose.local.yml`. `ops/postgres-image.sh` reads it for `ops/backup.sh`, `ops/restore-check.sh`, `ops/image-smoke.sh` and CI (checked by `apps/web/tests/postgres-image.test.ts`); the backup scripts refuse a container with another image digest. Dependabot's minor PR moves tag and digest and carries the `hold` label, so it is never merged as is. Minors keep the data directory. Back up and restore-check (`ops/live-account.md`), merge the new pin, then recreate the live container at once, as the service account, with `EMBER_PG_PORT=55438 ops/docker.sh compose -f ops/compose.local.yml up -d --wait` (the development one with plain `ops/docker.sh compose …`). Until then `ops/backup.sh` and deploys that add migrations refuse. To go back, pin the previous one and recreate again.

## Resource limits

`ops/install.sh` installs the slices in `ops/systemd/`, which hold the caps:

- `ember-live.slice`: `ember.service`, the Docker daemon, the PostgreSQL container and the `ember-app` container, whose own limits (`ops/start.sh`) keep it from crowding the database.
- `ember-jobs.slice`: test runs in the owner's user manager (through `ops/limited.sh`) and auto-deploy runs in the service account's. The API build in `pretest:e2e` runs outside it, and tests' database work counts against the live slice.

Other host services run in the system slice, so these hard caps, not CPU weights, protect them. Low I/O priority needs a priority-aware disk scheduler; without one (common for NVMe) disk I/O is uncapped.
