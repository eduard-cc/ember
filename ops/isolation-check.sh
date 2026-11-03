#!/usr/bin/env bash
# Check, as the Ember service account, that it cannot reach what it must not: root (sudo),
# the root and owner Docker daemons, the owner's files, and the given host:port endpoints
# (other loopback services, this host's tailnet address, Docker bridge addresses), also from
# a subordinate uid in its own user namespace. Also checks that the internet, DNS and the
# app's own origin still work. Prints one line per check; exits 1 if any
# check fails.
#
#   ops/isolation-check.sh <owner-home> [host:port ...]
#   sudo /usr/local/sbin/ember-run -- \
#       bash -s -- /home/owner 127.0.0.1:<port> <ops/isolation-check.sh
set -Euo pipefail
(($# >= 1)) || {
	echo "usage: $(basename "$0") <owner-home> [host:port ...]" >&2
	exit 2
}
owner_home=$1
shift
failed=0
pass() { echo "ok      $*"; }
bad() {
	echo "FAIL    $*"
	failed=1
}
# Succeeds when a TCP connection to $1:$2 completes within three seconds.
# shellcheck disable=SC2016 # $1 and $2 belong to the inner shell
connects() { timeout 3 bash -c 'exec 3<>"/dev/tcp/$1/$2"' _ "$1" "$2" 2>/dev/null; }

((EUID != 0)) || bad 'running as root'
groups=$(id -Gn)
if [[ $groups == "$(id -un)" ]]; then pass "no supplementary groups ($groups)"; else bad "supplementary groups: $groups"; fi
if sudo -n true 2>/dev/null; then bad 'sudo works'; else pass 'sudo refused'; fi
for socket in /var/run/docker.sock "/run/user/$(stat -c %u "$owner_home" 2>/dev/null || echo 0)/ember/docker.sock" \
	/var/snap/lxd/common/lxd/unix.socket /var/lib/lxd/unix.socket; do
	if [[ -S $socket ]] && curl -s --max-time 3 --unix-socket "$socket" -o /dev/null http://localhost/version; then
		bad "can talk to $socket"
	else
		pass "cannot talk to $socket"
	fi
done
if ls -- "$owner_home" >/dev/null 2>&1; then bad "can list $owner_home"; else pass "cannot list $owner_home"; fi
for endpoint in "$@"; do
	host=${endpoint%:*} port=${endpoint##*:}
	host=${host#[} host=${host%]}
	if connects "$host" "$port"; then bad "can connect to $endpoint"; else pass "cannot connect to $endpoint"; fi
done
# A subordinate uid on the host network (rootlesskit --net=host) is fenced in too.
if (($#)) && command -v rootlesskit >/dev/null; then
	host=${1%:*} port=${1##*:}
	host=${host#[} host=${host%]}
	rootlesskit --net=host python3 -c '
import os, socket, sys
os.setuid(1)
try:
    socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=3)
except OSError:
    sys.exit(3)
' "$host" "$port" 2>/dev/null
	case $? in
	0) bad "a subordinate uid can connect to $1" ;;
	3) pass "a subordinate uid cannot connect to $1" ;;
	*) bad 'could not test a subordinate uid (rootlesskit failed)' ;;
	esac
fi
origin=$(sed -nE 's/^EMBER_ORIGIN="?([^"]*)"?$/\1/p' ~/.config/ember/runtime.env 2>/dev/null | tail -n 1)
if [[ -n $origin ]]; then
	if curl -fsS --max-time 10 -o /dev/null "$origin/api/v1/health"; then
		pass "the app answers at its origin ($origin)"
	else
		bad "the app does not answer at its origin ($origin; deploys check it)"
	fi
fi
# These host services are outside Ember's boundary even when their APIs normally require
# authentication: notably Tailscale LocalAPI can proxy TCP under the host daemon's uid.
# Probe both the primary uid and a delegated uid. Fail closed on probe setup errors.
ipc_probe='
import errno, os, socket, sys
from pathlib import Path
if sys.argv[1] == "delegated": os.setuid(1)
paths = ["/run/tailscale/tailscaled.sock", "/run/docker.sock", "/run/dbus/system_bus_socket",
         "/run/cups/cups.sock", "/var/snap/cups/common/run/cups.sock", "/tmp/.s.PGSQL.5432"]
# Same-uid processes outside this mount namespace can expose their filesystem
# through /proc/PID/root, including short-lived administrative transports.
direct_paths = tuple(paths)
for process in Path("/proc").iterdir():
    if not process.name.isdigit(): continue
    try:
        if process.stat().st_uid == os.getuid():
            paths.extend(str(process / "root") + path for path in direct_paths)
    except FileNotFoundError: pass  # A process may exit while enumerating.
failed = False
for path in paths:
    s = socket.socket(socket.AF_UNIX); s.settimeout(3)
    try:
        s.connect(path)
        print("OPEN host IPC:", path); failed = True
    except OSError as e:
        if e.errno not in (errno.ENOENT, errno.EACCES, errno.EPERM):
            print("unexpected IPC error:", path, type(e).__name__); failed = True
    finally: s.close()
sys.exit(1 if failed else 0)
'
if python3 -c "$ipc_probe" primary; then pass 'host IPC hidden from the primary uid'; else bad 'primary-uid IPC isolation'; fi
if rootlesskit --net=host python3 -c "$ipc_probe" delegated; then pass 'host IPC hidden from a subordinate uid'; else bad 'subordinate-uid IPC isolation'; fi
if command -v crontab >/dev/null; then
	cron_result=$(LC_ALL=C crontab -l 2>&1) || true
	if [[ $cron_result == *'Permission denied'* ]]; then pass 'crontab spool inaccessible'; else bad 'crontab may schedule outside this manager'; fi
fi
if getent hosts github.com >/dev/null; then pass 'DNS resolves'; else bad 'DNS does not resolve (needed for deploys)'; fi
if curl -fsS --max-time 10 -o /dev/null https://api.github.com/zen; then
	pass 'internet reachable'
else
	bad 'internet unreachable (needed for deploys)'
fi
exit "$failed"
