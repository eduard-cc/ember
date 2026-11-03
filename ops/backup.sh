#!/usr/bin/env bash
# Local plaintext custom-format archive; no scheduler, transfer, or production targets.
set -euo pipefail
umask 077
[[ $# == 2 ]] || { printf '%s\n' 'Usage: backup.sh ember[_backup_test_ID] /private/path/new.dump' >&2; exit 1; }
db=$1; output=$2
[[ "$db" == ember || "$db" =~ ^ember_backup_test_[0-9]+$ ]] || { printf '%s\n' 'Refusing database outside the isolated Ember backup scope.' >&2; exit 1; }
[[ ! -e "$output" && ! -L "$output" ]] || { printf '%s\n' 'Refusing to overwrite an archive.' >&2; exit 1; }
parent=$(dirname -- "$output")
[[ -d "$parent" && $(stat -c %a "$parent") == 700 ]] || { printf '%s\n' 'Archive parent must be a private 0700 directory.' >&2; exit 1; }
# shellcheck source=ops/docker-host.sh
source "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/docker-host.sh"
container=ember-postgres
actual=$(docker inspect --format '{{.Config.Image}} {{.State.Health.Status}} {{range (index .NetworkSettings.Ports "5432/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$container")
# 55439 on the owner's development daemon, 55438 in the service account's (live) daemon.
expected='postgres:17.11-bookworm healthy 127.0.0.1'
[[ "$actual" == "$expected:55439" || "$actual" == "$expected:55438" ]] || { printf '%s\n' 'Refusing unexpected PostgreSQL container/image/endpoint.' >&2; exit 1; }
temporary=$(mktemp "$parent/.ember-dump.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
docker exec "$container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner --no-acl --exclude-table-data=public.sessions' sh "$db" > "$temporary"
docker exec -i "$container" pg_restore --list < "$temporary" > /dev/null
# Hard-link publication is atomic and fails if another writer claimed the path.
ln -- "$temporary" "$output"
printf '%s\n' 'Local PostgreSQL archive validated (sessions excluded).'
