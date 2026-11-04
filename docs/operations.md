# Backups, restore drills and host isolation

Read before touching backups, the database container, the Docker daemon, systemd units or slices, or anything else shared with the host. The Production data rules in AGENTS.md are hard limits on top of this.

## Local backups

`ops/backup.sh` writes task-scoped plaintext custom-format PostgreSQL archives (session data excluded) to `~/.local/share/ember-backups/`, which stays on this disk. `ops/restore-check.sh <archive> <db>` restores one into a new isolated validation database only; the row-count comparison with `ember` is left to the caller. Both have a real PostgreSQL test. Preserve archives privately.

## Off-device backup

A nightly root-owned backup job outside this repository dumps the live `ember` database with `pg_dump -Fc` and stores the dump in an encrypted off-device backup. Check that the newest off-device dump restores without touching the live database:

```sh
# Fetch the newest dump read-only with the off-device backup's own tooling (outside this repository).
as_ember() { sudo /usr/local/sbin/ember-run -- "$@"; }
db=ember_restore_validation_$(date +%Y%m%d%H%M%S)
<fetch the newest off-device dump> |
  as_ember bash -c 'umask 077 && cat >~/drill.dump'
as_ember bash -c "cd ~/src/ember && ops/restore-check.sh ~/drill.dump $db"
# compare "$db" with ember (below), then:
as_ember bash -c "cd ~/src/ember && ops/docker.sh exec ember-postgres dropdb -U ember $db && shred -u ~/drill.dump"
```

`--no-lock` keeps the drill read-only on the repository; never run `forget`, `prune` or `unlock` by hand. Unlike `ops/backup.sh` archives, this dump is a full `pg_dump` that includes the `sessions` table, so treat the validation database and the local file as secret and remove them promptly. Before dropping it, compare every table of the validation database with `ember` (row count and an ordered `md5` of all rows, plus the schema from `pg_dump -s`); differences must be explained by writes after the snapshot time, typically new sessions or synced records. Repeat the drill after database changes.

Last verified: snapshot `<latest>` restored, and all six tables, the migration sequence and the schema matched live exactly. Recovery on a rebuilt machine has not been rehearsed.

## Service account

The live app and everything that builds or deploys it run as the dedicated `ember` account, never as the owner: `ember-auto-deploy`, `ember.service`, Ember's Docker daemon and database, and its Tailscale device all live in that account's lingering user manager, and every `~` path in these docs and in `docs/deploy.md` means its home. Code from `main` and from npm runs there, so treat the account as untrusted:

- It has no password, no login shell and no supplementary groups (sudo, docker, lxd and adm are each a way out), its home is private, and the owner's home is closed to it.
- Unix permissions do not cover the network: every local user can reach loopback services (browser debugging ports, Hermes, other databases), this host's own tailnet address and Docker bridge networks. A root nftables table, `ember_egress_<uid>` (`ops/host/egress.nft.in`, loaded by `ember-egress-ember.service`, which the account's `user@<uid>.service` requires, so nothing starts without it), lets the account, and the subordinate uids it can switch to in its own user namespaces, reach only the internet, DNS, its own loopback ports (app 5191, database 55438), HTTPS on its own tailnet device (the deploy checks the app through Serve), and nothing else on the host, LAN or tailnet.
- User-unit sandboxing (`ProtectHome=`, `InaccessiblePaths=`, `IPAddressDeny=` and the like) is silently ignored on hosts that restrict unprivileged user namespaces, and the account controls its own user manager anyway. The root-owned `user@<uid>.service.d/ember-isolation.conf` (`ops/host/user-manager.conf`) instead gives the entire manager an inherited mount namespace: an empty read-only `/run`, the account's own runtime directory, just systemd's boot marker/notification/logging endpoints and DNS configuration files, and private temporary directories. Host Tailscale LocalAPI, system D-Bus, printing and other users' sockets are absent. The separate snap printing directory and crontab spool are inaccessible; setup refuses an existing crontab so no scheduled code can escape this manager. The namespace, uid permissions and firewall together enforce the boundary. Rootlesskit children cannot unmount these inherited restrictions.
- GitHub access is a fine-grained token limited to this repository with read-only Contents, Actions and Metadata, stored in the account's own `gh` config (it has no keyring). Alerts go to a Discord webhook in `~/.config/ember/discord-webhook` (`ops/notify.sh`), not through the owner's Hermes.
- Set it up with `ops/host/setup-account.sh` (root) and `ops/host/setup-service-user.sh` (as the account), both run from a reviewed checkout. `ops/isolation-check.sh`, run as the account, shows what it can and cannot reach.

If a root-owned manager drop-in changes, stop that account's manager before rerunning setup, then start it again; setup refuses to change the namespace of an active manager. Run Ember commands in the account's own user manager, for example `sudo /usr/local/sbin/ember-run -- bash -c 'cd ~/src/ember && ops/deploy.sh <commit>'`, `sudo /usr/local/sbin/ember-run -- systemctl --user status ember.service` and `sudo journalctl _UID=$(id -u ember) _SYSTEMD_USER_UNIT=ember-auto-deploy.service`. `ember-run` is a reviewed root-owned copy installed by account setup. It pins the protected manager's mount namespace, enters it while privileged, clears groups/environment and drops to Ember before contacting the local user bus; only the fixed OS tools before that drop run as root. Never use `systemd-run` or `systemctl` with `-M ember@`: its same-uid transport runs outside that namespace and exposes host IPC through `/proc/PID/root`. The isolation check probes these process-root paths too. Never execute app code from the account's home or checkout as the owner or as root: the account can rewrite it.

The owner's two monthly Hermes checks (`ops/postgres-update-check.sh`, `ops/dependency-check.sh`) need the owner's kanban board, so they run as the owner, but never from a checkout: their cron wrappers run reviewed copies installed outside the repository with `EMBER_REPO` pointing at the owner's checkout, which they only read (the compose pin, `.nvmrc`, lockfiles via `npm audit`). After a change to either script ships, reinstall its copy from the reviewed commit.

Accepted exposure: the account can read world-readable files and see other users' process command lines, and code running as it can read and change Ember's data and use the Ember tailnet device's identity, which a tailnet ACL tag limits to inbound connections from the owner's devices.

## Rootless Docker daemon

Ember runs its PostgreSQL container in its own rootless Docker daemon, `ember-docker.service` in the service account, with the socket at `$XDG_RUNTIME_DIR/ember/docker.sock` and data under `~/.local/share/ember-docker`. The live `ember` database is published on 127.0.0.1:55438 (`EMBER_PG_PORT=55438 ops/docker.sh compose -f ops/compose.local.yml up -d --wait`); the server accepts that port for the `ember` database only. Development and test databases stay on the owner's own daemon and container on 55439, which keeps no live data. Nothing using that socket can see other daemons' containers. Use `ops/docker.sh` (the Docker CLI pointed at that socket, ignoring any exported `DOCKER_HOST`) for every Ember container command; `ops/backup.sh`, `ops/restore-check.sh`, `ops/deploy.sh` and the backup test use it too. CI points `EMBER_DOCKER_HOST` at its runner's daemon instead.

The nightly off-device backup dumps `ember` through the service account's socket and skips the daemon's raw data directory, which carries a `CACHEDIR.TAG`. Keep the container, database and socket names stable.

## PostgreSQL version

The image is pinned to an exact minor (`postgres:17.N-bookworm`) in `ops/compose.local.yml`, `ops/backup.sh`, `ops/restore-check.sh` and CI; `tests/postgres-image.test.ts` keeps them equal. A monthly Hermes cron job runs `ops/postgres-update-check.sh` (see below for how) and queues an "Ember: bump PostgreSQL" card when a newer 17.x minor ships. Minor updates keep the data directory. Back up and restore-check with the old scripts, push the new pin, then recreate the live container at once, as the service account, with `EMBER_PG_PORT=55438 ops/docker.sh compose -f ops/compose.local.yml up -d --wait` (and the development one with plain `ops/docker.sh compose …`). Until then `ops/backup.sh` and deploys that add migrations refuse, because the pin no longer matches the container. To go back, pin the previous minor and recreate again.

## npm dependencies and Node

The lockfiles pin every npm package, and CI and `ops/deploy.sh` install them with `npm ci`. A monthly Hermes cron job runs `ops/dependency-check.sh`. It queues an "Ember: dependency and Node updates" card when `npm audit --omit=dev` reports a high or critical advisory in the app or server, when the Node that `ember.service` runs (the service account's `~/.local/bin/node`, a pinned official build installed by `ops/host/setup-service-user.sh`; the owner's cron cannot read that home, so it sets `EMBER_NODE` to a wrapper that runs it with `sudo /usr/local/sbin/ember-run -- /home/ember/.local/bin/node`) is behind a security release in its major, or when that major differs from `.nvmrc`, which CI uses. It ignores moderate advisories and dev-only packages, and the same findings never queue a second card. Fix advisories with in-major updates, never `npm audit fix --force`. Update Node by rerunning `ops/host/setup-service-user.sh` as the account with the new version, then restarting `ember.service`. `ops/test-dependency-check.sh` checks its decisions with fake npm, node, curl and hermes; it is local-only.

## Resource limits

Installed by `ops/install.sh`, units in `ops/systemd/`:

- `ember-live.slice` holds `ember.service`, the Docker daemon and the PostgreSQL container: at most 2 CPUs, 1.5 GiB memory (throttled from 1 GiB) and 512 MiB swap. The app and daemon run at nice 5 with low best-effort I/O priority.
- `ember-jobs.slice` holds test runs (in the owner's user manager): the npm `test:*` scripts and `server` `test:e2e` start through `ops/limited.sh` (nice 10, low I/O priority), browsers, dev servers and test API processes included. At most 4 CPUs, 4 GiB memory and 1 GiB swap. The server build in `pretest:e2e` runs outside it, and the database work tests cause counts against the live slice, since PostgreSQL runs there. CI runs the commands directly. In the service account's user manager it holds the auto-deploy builds (`ember-auto-deploy.service`).

System services sit outside the user manager, so these hard caps, not CPU weights, are what protect them. The I/O priority only takes effect under a priority-aware disk scheduler, and the user manager has no I/O controller; disks without such a scheduler (common for NVMe) leave disk I/O uncapped.

## Crash loops

If the service crash-loops (five starts in five minutes), systemd stops it and `ember-notify-failure@` sends a Discord alert. Its helper is a reviewed copy of `ops/notify.sh` installed at `~/.local/lib/ember/notify.sh` by `ops/install.sh`, never a script executed from the checkout: the owner's retained development daemon uses the same notifier. After a notifier change, reinstall from the reviewed source. User units cannot trigger the root `notify-failure@` unit, so this is a user-level equivalent.
