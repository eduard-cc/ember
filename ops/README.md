# Ember operations

The live app runs from releases as a dedicated service account, never from a checkout. `ember-auto-deploy.timer` deploys the head of `main` once its CI has passed: `deploy.sh` pulls the image CI published for that commit by its recorded digest, copies its web shell into `~/.local/share/ember/releases/<commit>/`, switches the `current` link, restarts `ember.service` (which runs the image as the `ember-app` container through the installed `start.sh`) and checks the app through Tailscale Serve, rolling back on failure. Database migrations are never rolled back. Procedures and traps: `docs/deploy.md` (deploys, releases, live checks) and `docs/operations.md` (service account, Docker daemon, backups, resource limits).

| File                                 | Purpose                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `auto-deploy.sh`                     | Timer entry point: fast-forwards the account's checkout and runs `deploy.sh` on a green `main`, holding failures |
| `deploy.sh`, `rollback.sh`, `lib.sh` | Fetch and switch a release, roll back to the previous healthy one; `lib.sh` holds the checks                     |
| `backup.sh`, `restore-check.sh`      | Validated `pg_dump` of the live database and a restore drill into a disposable validation database               |
| `install.sh`                         | Installs the user units, slices, the reviewed launcher and alert notifier; restarts nothing                      |
| `start.sh`                           | `ember.service`'s launcher (installed copy): runs the current release's image as the `ember-app` container       |
| `notify.sh`                          | Sends an alert to the owner's Hermes webhook, queueing it while Hermes is unreachable                            |
| `docker.sh`, `docker-host.sh`        | The Docker CLI pointed at Ember's own rootless daemon                                                            |
| `compose.local.yml`                  | The `ember-postgres` container (development daemon, and the live one with `EMBER_PG_PORT`)                       |
| `limited.sh`                         | Runs the npm test scripts in the capped `ember-jobs.slice`                                                       |
| `isolation-check.sh`                 | Shows what the service account can and cannot reach                                                              |
| `image-smoke.sh`                     | Runtime smoke test of a built image with synthetic settings (`docs/ci-and-tests.md`)                             |
| `ghcr-retention.sh`                  | Lists, or with `--delete` deletes, old versions of the GHCR image; CI runs it as a dry run                       |
| `host/`                              | Root-run account setup, the egress firewall, the user-manager drop-in and the `ember-run` entry point            |
| `systemd/`                           | The app, Docker daemon, Tailscale device, auto-deploy timer, notifier units and slices                           |
| `test-*.sh`, `test-ember-run.py`     | Synthetic checks of install, launcher, deploy, auto-deploy, release switch and `ember-run`                       |

`ops/` scripts run from the checkout they live in, so the service account's checkout must be a clean `main` that fast-forwards. Releases never update those scripts, and deploys never reinstall the launcher or units: fast-forward the checkout before running `deploy.sh` by hand, and rerun `install.sh` after `start.sh` or a unit changes (`docs/deploy.md`). `test-release-switch.sh` needs a systemd user session and runs only locally; CI runs the other checks (`docs/ci-and-tests.md`).
