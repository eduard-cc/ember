#!/usr/bin/env bash
# Point the live app back at the previous healthy release and restart it.
#
#   ops/rollback.sh
#
# Database migrations are not rolled back; restore the pre-deploy backup for that.
ACTION=rollback
SCRIPT_DIR=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")
# shellcheck source=ops/lib.sh
source "$SCRIPT_DIR/lib.sh"

(($# == 0)) || {
	echo "usage: $(basename "$0")" >&2
	exit 2
}
lock
check_config
roll_back || {
	notify "Manual rollback from $(current_release) FAILED. Ember needs attention: journalctl --user -u $EMBER_UNIT -n 50"
	die 'rollback failed; the app may be unhealthy'
}
