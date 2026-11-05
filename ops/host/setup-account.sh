#!/usr/bin/env bash
# Create or update an Ember service account and its egress firewall. Root only, run from a
# reviewed checkout, never from the service account's own clone (that account can rewrite
# it). Idempotent.
#
#   sudo ops/host/setup-account.sh <account> <loopback-ports> <tailnet-https-addresses>
#   sudo ops/host/setup-account.sh ember 5191,55438,<webhook-port> 100.64.0.10,fd7a:115c:a1e0::a
#
# <loopback-ports> are the only 127.0.0.1 TCP ports the account may connect to: the app,
# its database and the owner's Hermes webhook (alerts). <tailnet-https-addresses> (IPv4 and IPv6)
# are the only tailnet destinations it may reach, on HTTPS only: Ember's own tailnet device
# (the deploy health check goes through its Serve origin).
#
# The account gets no password, no login shell and no supplementary groups (sudo, docker,
# lxd or adm would each be a way back to root or to other accounts), a private home,
# subordinate ids for its rootless Docker daemon, and a lingering user manager, which
# cannot start before its firewall is loaded.
set -Eeuo pipefail
export LC_ALL=C
die() {
	echo "setup-account: $*" >&2
	exit 1
}
(($# == 3)) || die 'usage: setup-account.sh <account> <loopback-ports> <tailnet-https-addresses>'
account=$1 ports=$2 tailnet4=() tailnet6=()
[[ $EUID == 0 ]] || die 'run as root'
[[ $account =~ ^ember(-[a-z]+)?$ ]] || die "account must be ember or ember-<word>, not '$account'"
[[ $ports =~ ^[0-9]{2,5}(,[0-9]{2,5})*$ ]] || die "loopback ports must be a comma-separated list, not '$ports'"
IFS=, read -ra addresses <<<"$3"
for address in "${addresses[@]}"; do
	if [[ $address =~ ^100\.([0-9]{1,3}\.){2}[0-9]{1,3}$ ]]; then
		tailnet4+=("$address")
	elif [[ $address =~ ^fd7a:115c:a1e0:[0-9a-f:]+$ ]]; then
		tailnet6+=("$address")
	else
		die "not a tailnet address: '$address'"
	fi
done
((${#tailnet4[@]} && ${#tailnet6[@]})) || die 'give each tailnet device both its IPv4 and IPv6 address'
here=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")

if ! id -u -- "$account" >/dev/null 2>&1; then
	useradd --create-home --user-group --shell /usr/sbin/nologin --comment 'Ember service account' -- "$account"
fi
uid=$(id -u -- "$account")
home=$(getent passwd -- "$account" | cut -d: -f6)
((uid >= 1000)) || die "$account has system uid $uid; rootless Docker and lingering need a regular account"
[[ $(id -Gn -- "$account") == "$account" ]] || die "$account has supplementary groups: $(id -Gn -- "$account")"
passwd --lock -- "$account" >/dev/null
chmod 700 -- "$home"

# Rootless Docker maps container ids onto a range only this account owns.
for file in /etc/subuid /etc/subgid; do
	grep -q "^$account:" "$file" && continue
	next=$(awk -F: 'BEGIN { n = 100000 } { e = $2 + $3; if (e > n) n = e } END { print n }' "$file")
	echo "$account:$next:65536" >>"$file"
done

# Processes the account moves to these uids in its own user namespaces (rootlesskit
# --net=host, for one) still use the host network, so the firewall covers them too.
subuids=$(awk -F: -v a="$account" '$1 == a { printf "%s%d-%d", (n++ ? ", " : ""), $2, $2 + $3 - 1 }' /etc/subuid)
[[ -n $subuids ]] || die "no subordinate uids for $account in /etc/subuid"
# No already-scheduled work may run this uid outside its constrained manager.
[[ ! -e /var/spool/cron/crontabs/$account ]] || die "$account has a crontab; remove it before setup"
manager_dir=/etc/systemd/system/user@$uid.service.d
if ! cmp -s "$here/user-manager.conf" "$manager_dir/ember-isolation.conf"; then
	! systemctl is-active --quiet "user@$uid.service" ||
		die "stop user@$uid.service before installing or changing its isolation namespace"
	install -d -m 755 "$manager_dir"
	install -o root -g root -m 644 "$here/user-manager.conf" "$manager_dir/ember-isolation.conf"
fi

table=ember_egress_$uid
install -d -m 755 /etc/ember
join() {
	local IFS=, joined
	joined="$*"
	echo "${joined//,/, }"
}
sed -e "s/@ACCOUNT@/$account/g" -e "s/@UID@/$uid/g" -e "s/@SUBUIDS@/$subuids/g" -e "s/@TABLE@/$table/g" \
	-e "s/@LOOPBACK_PORTS@/${ports//,/, }/g" \
	-e "s/@TAILNET_IPV4@/$(join "${tailnet4[@]}")/g" -e "s/@TAILNET_IPV6@/$(join "${tailnet6[@]}")/g" \
	"$here/egress.nft.in" >"/etc/ember/egress-$account.nft.new"
nft --check -f "/etc/ember/egress-$account.nft.new"
mv -T -- "/etc/ember/egress-$account.nft.new" "/etc/ember/egress-$account.nft"

# Fail closed: the account's user manager (and so every Ember unit) requires the firewall.
cat >"/etc/systemd/system/ember-egress-$account.service" <<EOF
# Written by ember ops/host/setup-account.sh.
[Unit]
Description=Egress firewall for the Ember service account $account
Before=network-pre.target user@$uid.service
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/ember/egress-$account.nft
ExecReload=/usr/sbin/nft -f /etc/ember/egress-$account.nft
ExecStop=/usr/sbin/nft delete table inet $table

[Install]
WantedBy=multi-user.target
RequiredBy=user@$uid.service
EOF
systemctl daemon-reload
systemctl enable "ember-egress-$account.service"
# Reload, not restart: restarting would restart the user manager that requires it.
systemctl reload-or-restart "ember-egress-$account.service"
nft list table inet "$table" >/dev/null
if [[ $account == ember ]]; then
	install -o root -g root -m 755 "$here/ember-run" /usr/local/sbin/ember-run
fi
loginctl enable-linger -- "$account"
echo "setup-account: $account (uid $uid) ready; egress table $table loaded"
