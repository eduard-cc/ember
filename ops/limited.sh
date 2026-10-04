#!/usr/bin/env bash
# Run a command in gym-log-jobs.slice (CPU and memory caps, ops/systemd/) at low CPU and
# I/O priority. The npm test scripts go through this, so a runaway gym test run cannot
# starve other services on the host. The I/O class only takes effect under a
# priority-aware disk scheduler, which many NVMe disks do not use.
#   ops/limited.sh <command> [args...]
set -Eeuo pipefail
# GitHub runners have no user systemd, and the runner VM is the limit there.
[[ ${CI:-} != true ]] || exec "$@"
# Without the installed slice, systemd-run would quietly create an uncapped one.
systemctl --user cat gym-log-jobs.slice >/dev/null 2>&1 || {
	echo 'ops/limited.sh: gym-log-jobs.slice is not installed (run ops/install.sh) or there is no user systemd session' >&2
	exit 1
}
exec systemd-run --user --scope --quiet --collect --slice=gym-log-jobs.slice --nice=10 -- ionice -c 2 -n 7 "$@"
