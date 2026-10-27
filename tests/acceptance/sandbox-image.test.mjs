// Container-level checks for the sandbox image: no sbx, KVM, login or secrets.
import { test } from "vitest";
import { runCommand } from "../support/engine.mjs";

const image = process.env.PI_BOX_SANDBOX_IMAGE || "pi-box:0.2.0-sandbox";

// One disposable container runs the whole check script, which stops at the
// first failing check (set -eu).
test(`${image}: agent user, bundled tools and registrations, no credentials`, () => {
  runCommand("docker", [
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
      test "$(uv python dir)" = "$HOME/.local/share/uv/python"
      test "$(uv tool dir)" = "$HOME/.local/share/uv/tools"
      test "$(uv tool dir --bin)" = "$HOME/.local/bin"
      ruff --version
      ty --version
      biome --version
      claude --version
      node --input-type=module -e '
        import assert from "node:assert/strict";
        import { readFileSync } from "node:fs";
        import { homedir } from "node:os";
        const read = (path) => JSON.parse(readFileSync(path, "utf8"));
        const manifest = read("/opt/pi/package.json");
        const expected = Object.keys(manifest.dependencies)
          .filter((name) => name !== "@earendil-works/pi-coding-agent" && !manifest.piBox.npmTools.includes(name))
          .map((name) => "/opt/pi/node_modules/" + name);
        if (manifest.piBox.personalSkills) expected.push("/opt/pi/node_modules/personal-skills");
        assert.equal(read("/opt/pi/node_modules/personal-skills/package.json").name, "personal-skills");
        const actual = read(homedir() + "/.pi/agent/settings.json").packages
          .map((item) => typeof item === "string" ? item : item.source);
        assert.deepEqual(actual.sort(), expected.sort());
      '
      printf '{"synthetic":"not-a-real-token"}' > ~/.pi/agent/auth.json
      node /opt/pi/init-agent.mjs
      test "$(cat ~/.pi/agent/auth.json)" = '{"synthetic":"not-a-real-token"}'
      test "$(umask)" = 0077
      if tmux list-sessions 2>/dev/null; then exit 1; fi
      tmux new-session -d -s shell -c "$PWD"
      tmux has-session -t '=shell'
      tmux kill-server
      echo sandbox-image-ok`,
  ], { inherit: true });
});
