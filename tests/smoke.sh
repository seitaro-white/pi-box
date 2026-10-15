#!/usr/bin/env bash
# Disposable image checks: startup, packages/extensions and persistent storage.
set -euo pipefail
cd "$(dirname "$0")/.."
source tests/helpers/engine.sh

PROFILE="${PI_BOX_PROFILE:-recommended}"
case "$PROFILE" in
    recommended) DEFAULT_IMAGE=pi-box:0.2.0 ;;
    base) DEFAULT_IMAGE=pi-box:0.2.0-base ;;
    *) echo 'PI_BOX_PROFILE must be base or recommended' >&2; exit 1 ;;
esac
IMAGE="${PI_BOX_IMAGE:-$DEFAULT_IMAGE}"
EXPECTED_PI_VERSION="$(node -p 'require("./container/package.json").dependencies["@earendil-works/pi-coding-agent"]')"
EXPECTED_DEPENDENCIES_JSON="$(node -p 'JSON.stringify(require("./container/package.json").dependencies)')"
name="pi-box-smoke-$(date +%s)-$$"
web="$name-web"
workspace="$name-workspace"
agent="$name-agent"
git_volume="$name-git"
label="io.pi-box.smoke=$name"
passed=false
trap 'if [ "$passed" != true ]; then printf "FAILED: inspect retained resources %s, %s, %s, %s, %s\n" "$name" "$web" "$workspace" "$agent" "$git_volume" >&2; fi' EXIT

"${P[@]}" info >/dev/null
if [[ $ENGINE == podman ]]; then
    [ "$("${P[@]}" info --format '{{.Host.Security.Rootless}}')" = true ]
fi
"${P[@]}" image inspect "$IMAGE" >/dev/null
for volume in "$workspace" "$agent" "$git_volume"; do
    existing_volumes="$("${P[@]}" volume ls --format '{{.Name}}')"
    if grep -Fxq "$volume" <<< "$existing_volumes"; then
        echo "Refusing to reuse $volume" >&2; exit 1
    fi
    "${P[@]}" volume create --label "$label" "$volume" >/dev/null
done

wait_for_startup() {
    for ((i=0; i<30; i++)); do
        if "${P[@]}" exec "$name" tmux has-session -t '=shell' 2>/dev/null; then return; fi
        sleep 1
    done
    "${P[@]}" logs "$name"
    echo 'Container startup did not complete' >&2
    exit 1
}

launch() {
    "${P[@]}" run -d --name "$name" --label "$label" \
        --cap-drop=ALL --security-opt=no-new-privileges --network=none \
        -v "$workspace:/workspace" -v "$agent:/home/node/.pi/agent" \
        -v "$git_volume:/home/node/.config/git" \
        "$IMAGE" >/dev/null
    wait_for_startup
}

printf '\n=== %s image: %s ===\n' "$PROFILE" "$IMAGE"
launch
"${P[@]}" exec -i -e EXPECTED_PI_VERSION="$EXPECTED_PI_VERSION" -e EXPECTED_PROFILE="$PROFILE" \
    "$name" sh -s < tests/fixtures/check-identity.sh
"${P[@]}" exec -i -e PI_OFFLINE=1 -e EXPECTED_DEPENDENCIES_JSON="$EXPECTED_DEPENDENCIES_JSON" \
    "$name" node --input-type=module < tests/fixtures/check-extensions.mjs
"${P[@]}" exec -i "$name" node --input-type=module < tests/fixtures/seed-storage.mjs

for transition in restart replacement; do
    if [[ $transition == restart ]]; then
        "${P[@]}" stop --time 10 "$name" >/dev/null
        "${P[@]}" start "$name" >/dev/null
        wait_for_startup
    else
        # Replace only this test's container, reusing only this test's volumes.
        "${P[@]}" rm --force "$name" >/dev/null
        launch
    fi
    "${P[@]}" exec -i -e STORAGE_TRANSITION="$transition" "$name" node --input-type=module \
        < tests/fixtures/check-persistence.mjs
done

if [[ $PROFILE == recommended ]]; then
    # Separate container: no live mounts or credentials. Only this HTTP probe
    # needs a network; the storage/registration checks above stay network-disabled.
    "${P[@]}" run -d --name "$web" --label "$label" \
        --cap-drop=ALL --security-opt=no-new-privileges \
        --publish 127.0.0.1::19432 \
        -e PLANNOTATOR_DATA_DIR=/tmp/plannotator-test \
        "$IMAGE" >/dev/null
    "${P[@]}" cp tests/fixtures/serve-plannotator.mjs "$web:/tmp/serve-plannotator.mjs"
    "${P[@]}" exec -d "$web" node /tmp/serve-plannotator.mjs
    address="$("${P[@]}" port "$web" 19432/tcp)"
    [[ $address == 127.0.0.1:* ]]
    node tests/fixtures/check-plannotator-http.mjs "$address"
    "${P[@]}" rm --force "$web" >/dev/null
fi

"${P[@]}" rm --force "$name" >/dev/null
"${P[@]}" volume rm "$workspace" "$agent" "$git_volume" >/dev/null
passed=true
printf 'PASS: %s image: startup, pins, extension registration, permissions and restart/replacement persistence. No model calls.\n' "$PROFILE"
