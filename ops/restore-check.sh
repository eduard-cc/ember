#!/usr/bin/env bash
# Restore drills only: never an in-place replacement or ordinary database restore.
set -euo pipefail
umask 077
[[ $# == 2 ]] || { printf '%s\n' 'Usage: restore-check.sh archive.dump gym_log_restore_validation_ID' >&2; exit 1; }
archive=$1; target=$2
[[ "$target" =~ ^gym_log_restore_validation_[0-9]+$ ]] || { printf '%s\n' 'Refusing non-validation restore target.' >&2; exit 1; }
[[ -f "$archive" && ! -L "$archive" ]] || { printf '%s\n' 'Archive must be a regular non-symlink file.' >&2; exit 1; }
container=gym-log-local-postgres
actual=$(docker inspect --format '{{.Config.Image}} {{.State.Health.Status}} {{range (index .NetworkSettings.Ports "5432/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$container")
[[ "$actual" == 'postgres:17.6-bookworm healthy 127.0.0.1:55439' ]] || { printf '%s\n' 'Refusing unexpected PostgreSQL container/image/endpoint.' >&2; exit 1; }
# Preflight never mutates an existing target; validation and creation both fail closed.
exists=$(docker exec "$container" sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='\''$1'\''"' sh "$target")
[[ "$exists" == 0 ]] || { printf '%s\n' 'Refusing existing database; restore checks require a fresh target.' >&2; exit 1; }
docker exec -i "$container" pg_restore --list < "$archive" > /dev/null
created=false
cleanup() {
 if [[ "$created" == true ]]; then docker exec "$container" sh -c 'exec dropdb -U "$POSTGRES_USER" "$1"' sh "$target"; fi
}
trap cleanup EXIT
docker exec "$container" sh -c 'exec createdb -U "$POSTGRES_USER" "$1"' sh "$target"
created=true
docker exec -i "$container" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error --no-owner --no-acl' sh "$target" < "$archive"
docker exec "$container" sh -c 'exec psql -U "$POSTGRES_USER" -d "$1" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM public.records"' sh "$target" > /dev/null
created=false
printf '%s\n' 'Restored into isolated validation database; logical comparison remains the caller’s responsibility.'
