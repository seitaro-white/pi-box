#!/usr/bin/env bash
set -euo pipefail

IMAGE=${IMAGE:-pi-box:0.2.0}
CONTAINER=${CONTAINER:-pi-box-dev}
WORKSPACE_VOLUME=${WORKSPACE_VOLUME:-pi-box-workspace}
AGENT_VOLUME=${AGENT_VOLUME:-pi-box-agent}
GIT_VOLUME=${GIT_VOLUME:-pi-box-git}
RESET_LEGACY_GIT=${RESET_LEGACY_GIT:-0}

fail() { printf '%s\n' "$*" >&2; exit 1; }
exists() { docker container inspect "$CONTAINER" >/dev/null 2>&1; }

check() {
  docker info >/dev/null
  if ! exists; then
    echo "No existing $CONTAINER; replacement will create it."
    return
  fi
  local mounts running mount workspace=0 agent=0 git=0
  mounts=$(docker inspect --format '{{range .Mounts}}{{println .Type .Name .Destination}}{{end}}' "$CONTAINER")
  while IFS= read -r mount; do
    case "$mount" in
      "volume $WORKSPACE_VOLUME /workspace") workspace=$((workspace + 1)) ;;
      "volume $AGENT_VOLUME /home/node/.pi/agent") agent=$((agent + 1)) ;;
      "volume $GIT_VOLUME /home/node/.config/git") git=$((git + 1)) ;;
      *) fail "Unexpected mounts on $CONTAINER. Inspect them with docker inspect; set volume overrides to existing names. Extra or bind mounts require manual replacement." ;;
    esac
  done <<< "$mounts"
  [[ "$workspace" == 1 && "$agent" == 1 && "$git" -le 1 ]] || fail "Required persistent mounts are missing or duplicated."
  running=$(docker inspect --format '{{.State.Running}}' "$CONTAINER")
  [[ "$running" == true ]] || fail "Start $CONTAINER first so its non-persistent files can be checked."
  docker exec -e HAS_GIT_VOLUME="$git" -e RESET_LEGACY_GIT="$RESET_LEGACY_GIT" "$CONTAINER" sh -c '
    set -eu
    for path in /home/node/.gitconfig /home/node/.git-credentials /home/node/.config/git /home/node/.ssh /root/.gitconfig /root/.ssh /root/.git-credentials; do
      [ "$path" != /home/node/.config/git ] || [ "$HAS_GIT_VOLUME" != 1 ] || continue
      if [ -e "$path" ] || [ -L "$path" ]; then
        case "$path" in
          /home/node/.gitconfig|/home/node/.git-credentials|/home/node/.config/git)
            if [ "$RESET_LEGACY_GIT" = 1 ]; then
              echo "Explicit reset: disposable $path will be discarded on replacement."
              continue
            fi ;;
        esac
        echo "Refusing replacement: non-persistent $path exists. Preserve it manually, or use RESET_LEGACY_GIT=1 for disposable Git files only." >&2
        exit 1
      fi
    done
  ' || fail "Non-persistent credential/config check failed; old container kept."
  echo "Persistent mounts verified. Other files outside these mounts will be lost."
  echo "Review uncommitted work and stop running jobs before replacement."
}

wait_for_startup() {
  local attempts
  for ((attempts=0; attempts<30; attempts++)); do
    if docker exec "$CONTAINER" tmux has-session -t '=shell' 2>/dev/null; then return; fi
    sleep 1
  done
  fail "Container startup did not complete. Inspect docker logs $CONTAINER; persistent volumes have been retained."
}

case "${1:-}" in
  check) check ;;
  replace)
    docker image inspect "$IMAGE" >/dev/null
    docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" |
      grep -Fxq 'GIT_CONFIG_GLOBAL=/home/node/.config/git/config' ||
      fail "Image does not support the Git volume. Run make build first."
    check
    # Never stop another container sharing these volumes.
    for volume in "$WORKSPACE_VOLUME" "$AGENT_VOLUME" "$GIT_VOLUME"; do
      others=$(docker ps --filter "volume=$volume" --format '{{.Names}}')
      while IFS= read -r name; do
        [[ -z "$name" || "$name" == "$CONTAINER" ]] || fail "Volume $volume is in use by $name."
      done <<< "$others"
    done
    if exists; then
      docker stop "$CONTAINER"
      docker rm "$CONTAINER"
    fi
    docker run -d --name "$CONTAINER" \
      -v "$WORKSPACE_VOLUME:/workspace" \
      -v "$AGENT_VOLUME:/home/node/.pi/agent" \
      -v "$GIT_VOLUME:/home/node/.config/git" \
      --cap-drop=ALL --security-opt=no-new-privileges "$IMAGE"
    wait_for_startup
    ;;
  attach)
    wait_for_startup
    docker exec -it "$CONTAINER" tmux attach-session -t '=shell'
    ;;
  *) fail "Usage: bash scripts/dev-container.sh {check|replace|attach}" ;;
esac
