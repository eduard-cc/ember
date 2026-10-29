# Backups, restore drills and host isolation

Read before touching backups, the database container, the Docker daemon, systemd units or slices, or anything else shared with the host. The Production data rules in AGENTS.md are hard limits on top of this.

## Local backups

`ops/backup.sh` writes task-scoped plaintext custom-format PostgreSQL archives (session data excluded) to `~/.local/share/ember-backups/`, which stays on this disk. `ops/restore-check.sh <archive> <db>` restores one into a new isolated validation database only; the row-count comparison with `ember` is left to the caller. Both have a real PostgreSQL test. Preserve archives privately.

## Off-device backup

A nightly root-owned backup job outside this repository dumps the live `ember` database with `pg_dump -Fc` and stores the dump in an encrypted off-device backup. Check that the newest off-device dump restores without touching the live database:

```sh
# Fetch the newest dump read-only with the off-device backup's own tooling (outside this repository).
s=$(mktemp -d) db=ember_restore_validation_$(date +%Y%m%d%H%M%S)
<fetch the newest off-device dump> > "$s/ember.dump"
ops/restore-check.sh "$s/ember.dump" "$db"
# compare "$db" with ember (below), then:
ops/docker.sh exec ember-postgres dropdb -U ember "$db"
shred -u "$s/ember.dump" && rmdir "$s"
```

`--no-lock` keeps the drill read-only on the repository; never run `forget`, `prune` or `unlock` by hand. Unlike `ops/backup.sh` archives, this dump is a full `pg_dump` that includes the `sessions` table, so treat the validation database and the local file as secret and remove them promptly. Before dropping it, compare every table of the validation database with `ember` (row count and an ordered `md5` of all rows, plus the schema from `pg_dump -s`); differences must be explained by writes after the snapshot time, typically new sessions or synced records. Repeat the drill after database changes.

Last verified: snapshot `<latest>` restored, and all six tables, the migration sequence and the schema matched live exactly. Recovery on a rebuilt machine has not been rehearsed.

## Rootless Docker daemon

Ember runs its PostgreSQL container in its own rootless Docker daemon, `ember-docker.service`, with the socket at `$XDG_RUNTIME_DIR/ember/docker.sock` and data under `~/.local/share/ember-docker`. Nothing using that socket can see other daemons' containers. Use `ops/docker.sh` (the Docker CLI pointed at that socket, ignoring any exported `DOCKER_HOST`) for every Ember container command; `ops/backup.sh`, `ops/restore-check.sh`, `ops/deploy.sh` and the backup test use it too. CI points `EMBER_DOCKER_HOST` at its runner's daemon instead.

The nightly off-device backup dumps `ember` through that socket and skips the daemon's raw data directory, which carries a `CACHEDIR.TAG`. Keep the container, database and socket names stable.

## PostgreSQL version

The image is pinned to an exact minor (`postgres:17.N-bookworm`) in `ops/compose.local.yml`, `ops/backup.sh`, `ops/restore-check.sh` and CI; `tests/postgres-image.test.ts` keeps them equal. A monthly Hermes cron job runs `ops/postgres-update-check.sh` from this checkout and queues an "Ember: bump PostgreSQL" card when a newer 17.x minor ships. Minor updates keep the data directory. Back up and restore-check with the old scripts, push the new pin, then recreate the container at once with `ops/docker.sh compose -f ops/compose.local.yml up -d --wait`. Until then `ops/backup.sh` and deploys that add migrations refuse, because the pin no longer matches the container. To go back, pin the previous minor and recreate again.

## Resource limits

Installed by `ops/install.sh`, units in `ops/systemd/`:

- `ember-live.slice` holds `ember.service`, the Docker daemon and the PostgreSQL container: at most 2 CPUs, 1.5 GiB memory (throttled from 1 GiB) and 512 MiB swap. The app and daemon run at nice 5 with low best-effort I/O priority.
- `ember-jobs.slice` holds test runs: the npm `test:*` scripts and `server` `test:e2e` start through `ops/limited.sh` (nice 10, low I/O priority), browsers, dev servers and test API processes included. At most 4 CPUs, 4 GiB memory and 1 GiB swap. The server build in `pretest:e2e` runs outside it, and the database work tests cause counts against the live slice, since PostgreSQL runs there. CI runs the commands directly.

System services sit outside the user manager, so these hard caps, not CPU weights, are what protect them. The I/O priority only takes effect under a priority-aware disk scheduler, and the user manager has no I/O controller; disks without such a scheduler (common for NVMe) leave disk I/O uncapped.

## Crash loops

If the service crash-loops (five starts in five minutes), systemd stops it and `ember-notify-failure@` sends a Discord alert. User units cannot trigger the root `notify-failure@` unit, so this is a user-level equivalent.
