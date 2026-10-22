// Container-level checks for the sandbox image: no sbx, KVM, login or secrets.
import { createEngine } from "./helpers/engine.mjs";

const engine = createEngine(process.env);
const image = process.env.PI_BOX_SANDBOX_IMAGE || "pi-box:ci-sandbox";
engine.run([
  "run", "--rm", "--network=none", "--cap-drop=ALL",
  "--security-opt=no-new-privileges",
  image, "bash", "-lc", `set -eu
    test "$(id -un)" = agent
    test "$(id -u)" = 1000
    test "$HOME" = /home/agent
    test "$PWD" = /home/agent/workspace
    test ! -f ~/.pi/agent/auth.json
    test ! -f ~/.git-credentials
    test ! -S /var/run/docker.sock
    pi --version
    python3 --version
    uv --version
    ruff --version
    biome --version
    node -e 'const s=require(process.env.PI_CODING_AGENT_DIR+"/settings.json"); if(s.packages.length !== 4) process.exit(1)'
    printf '{"synthetic":"not-a-real-token"}' > ~/.pi/agent/auth.json
    node /opt/pi/init-agent.mjs
    test "$(cat ~/.pi/agent/auth.json)" = '{"synthetic":"not-a-real-token"}'
    test ! -e /usr/local/bin/pi-box-launch
    test ! -f /etc/tmux.conf
    test "$(umask)" = 0077
    if tmux list-sessions 2>/dev/null; then exit 1; fi
    tmux new-session -d -s shell -c "$PWD"
    tmux has-session -t '=shell'
    tmux kill-server
    echo sandbox-image-ok`,
], { inherit: true });
