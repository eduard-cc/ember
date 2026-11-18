# Working in the live account

Read before running commands as the `ember` service account, checking the live app, or shipping a change that needs backup evidence. The release layout, deploys and the account itself are in `ops/README.md`.

## Running commands

- `ember-run` hands its arguments unchanged to `systemd-run`, which expands `$VAR` and `${VAR}` in them the way a unit's `ExecStart=` does, before any shell sees them. Send a command that contains `$` as a script on stdin instead: `sudo /usr/local/sbin/ember-run -- bash -s < script.sh`, or a quoted heredoc.
- `runtime.env` stores values in double quotes (`EMBER_ORIGIN="https://…"`). Strip them before using a value, as `setting()` in `ops/lib.sh` does; a quoted URL makes curl fail, and comparing its empty output with `cmp` hides the error.

## Live check

`ops/livecheck.sh` is a read-only summary of the live app. Run it from any reviewed checkout as the owner; the account reads the script from stdin, so nothing executes from the owner's files as the account:

```sh
sudo -n /usr/local/sbin/ember-run -- bash -s < ops/livecheck.sh
```

It prints the current release and the account checkout's head, the last auto-deploy journal lines, the release's `IMAGE`, `/api/v1/health` on loopback and through Serve, whether `/sw.js` and the shell match the release byte for byte, the hold file and whether `ember.service` is active. It never prints the origin or other `runtime.env` values. A hold equal to the healthy current release is normal.

## Read-only UI checks

- Offline shell: use a fresh Pixel 6 browser context and intercept only `**/api/**` with a synthetic unavailable response, so owner history and mutations stay off the wire. Avoid a catch-all `context.route('**/*')`, even with `route.continue()`: in Chrome it leaves the reloaded page without a service-worker controller. Wait for activation, reload under the worker, then test offline reload and reopening in a fresh tab.
- A check that lets reads through and aborts every other `/api/**` request must still allow `POST /api/v1/session`: the app signs in with it on load when `GET /api/v1/session` answers 401 (`apps/web/src/sync/use-sync.ts`), and without it History stays empty.
- Never print private page text.

## Changes that need backup evidence

A schema migration, bulk data change or data repair, and merges such as a Node major or the PostgreSQL pin (`ops/README.md`), need a fresh backup, a verified restore and row counts from before and after. For a release that adds migrations, `ops/deploy.sh` takes and checks the backup itself; the comparison after the migration, and every step of a manual change, are yours.

1. Stop auto-deploy before merging: `sudo /usr/local/sbin/ember-run -- systemctl --user stop ember-auto-deploy.timer`.
2. In one script on stdin that holds the deploy lock on file descriptor 9 (as in `ops/README.md`, Deploying): record each table's row count, run `ops/backup.sh ember <archive>` into a private 0700 directory, `ops/restore-check.sh <archive> ember_restore_validation_<n>`, compare the restored counts, drop the validation database (`ops/docker.sh exec ember-postgres dropdb -U ember ember_restore_validation_<n>`), make the switch, then record the counts again.
3. Start the timer again (`systemctl --user start ember-auto-deploy.timer` in the account).

`ops/backup.sh` leaves out the `sessions` table's rows, so compare every other table.
