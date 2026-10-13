# Sourced by integration scripts; keep engine selection in one place.
ENGINE="${PI_BOX_ENGINE:-docker}"
case "$ENGINE" in
    docker) P=("${DOCKER_BIN:-docker}") ;;
    podman) P=("${PODMAN_BIN:-/opt/podman/bin/podman}" --connection "${PODMAN_CONNECTION:-podman-machine-default}") ;;
    *) echo 'PI_BOX_ENGINE must be docker or podman' >&2; exit 1 ;;
esac
