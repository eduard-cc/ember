# shellcheck shell=bash
# The PostgreSQL image, pinned once by tag and digest in ops/compose.local.yml. Sourced by
# every script that runs or checks it (and by CI); not executable on its own. Sets
# POSTGRES_IMAGE, or fails when the compose file does not hold exactly one such pin.
_postgres_pins=$(sed -nE 's/^    image: (postgres:[0-9]+\.[0-9]+-bookworm@sha256:[0-9a-f]{64})$/\1/p' \
	"$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")/compose.local.yml")
if [[ -z $_postgres_pins || $_postgres_pins == *$'\n'* ]]; then
	printf '%s\n' 'ops/compose.local.yml must pin exactly one postgres:17.N-bookworm@sha256:… image.' >&2
	unset _postgres_pins
	return 1
fi
POSTGRES_IMAGE=$_postgres_pins
unset _postgres_pins

# Succeeds when the ember-postgres container in the current daemon runs the pinned image (its
# tag, and an image whose registry digest is the pinned one), is healthy and publishes 5432 on
# loopback only: 55439 on the owner's development daemon, 55438 in the service account's (live)
# daemon. A container created from the tag alone passes as long as the digest matches.
postgres_container_pinned() {
	local tag=${POSTGRES_IMAGE%@*} digest=${POSTGRES_IMAGE#*@} actual image digests
	# One read, so the image id and the rest describe the same container.
	actual=$(docker inspect --format '{{.Image}} {{.Config.Image}} {{.State.Health.Status}} {{range (index .NetworkSettings.Ports "5432/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' ember-postgres) || return 1
	image=${actual%% *}
	actual=${actual#* }
	case $actual in
	"$tag healthy 127.0.0.1:"5543[89] | "$POSTGRES_IMAGE healthy 127.0.0.1:"5543[89]) ;;
	*) return 1 ;;
	esac
	[[ $image =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
	digests=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image") || return 1
	grep -qFx -- "postgres@$digest" <<<"$digests"
}
