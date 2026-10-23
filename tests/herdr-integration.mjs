// Persistent Herdr integration only: disposable project, no network/providers.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({ name: "herdr" }, async (p) => {
  writeFileSync(join(p.directory, "herdr-offline.yaml"),
    "services:\n  pi-box:\n    network_mode: none\n");
  const compose = (args, options) => p.compose([
    "-f", "compose.yaml", "-f", "herdr-offline.yaml", ...args,
  ], options);
  const exec = (args, options) => compose(["exec", "-T", "pi-box", ...args], options);
  const shell = (command) => exec(["sh", "-ec", command]);
  const api = (...args) => JSON.parse(exec(["herdr", ...args])).result;
  async function startServer() {
    compose(["exec", "-d", "pi-box", "herdr", "server"]);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if (/status: running/.test(exec(["herdr", "status", "server"]))) return;
      } catch { /* The socket may not exist yet. */ }
      await delay(100);
    }
    throw new Error("Herdr did not become ready");
  }
  const tmuxReady = () => exec(["tmux", "has-session", "-t", "=shell"]);
  compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60"]);
  const container = p.inspect(p.settings.CONTAINER);
  assert.equal(container.Config.User, "node");
  assert.equal(container.HostConfig.NetworkMode, "none");
  assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
  assert(container.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert.equal(container.Mounts.length, 4);
  assert.equal(container.Mounts.find((mount) => mount.Destination === "/home/node/.herdr")?.Name, p.settings.HERDR_VOLUME);
  tmuxReady();
  // Herdr stays stopped; the Pi integration is bundled, not installed globally.
  assert.match(exec(["herdr", "status", "server"]), /status: not running/);
  shell("test ! -e ~/.pi/agent/extensions/herdr-agent-state.ts");
  shell(`
    printf '\\n# operator canary\\n[update]\\nversion_check = false\\nmanifest_check = false\\n' >> ~/.config/herdr/config.toml
    printf durable-state > ~/.local/state/herdr/canary
    git init -b main /workspace/herdr-repo
    git -C /workspace/herdr-repo -c user.name=Smoke -c user.email=smoke@example.invalid commit --allow-empty -m initial
  `);
  const savedConfig = shell("sha256sum ~/.config/herdr/config.toml");
  await startServer();
  const created = api("workspace", "create", "--cwd", "/workspace/herdr-repo", "--label", "persistent-check", "--no-focus");
  assert(created.root_pane.pane_id);
  assert.equal(created.root_pane.cwd, "/workspace/herdr-repo");
  assert.equal(created.workspace.label, "persistent-check");
  const tree = api("worktree", "create", "--cwd", "/workspace/herdr-repo", "--branch", "feature/smoke", "--no-focus");
  assert(tree, "worktree created");
  const listing = exec(["git", "-C", "/workspace/herdr-repo", "worktree", "list", "--porcelain"]);
  assert.match(listing, /worktree \/workspace\/\.worktrees\//);
  // Find the workspace by its terminal cwd rather than predicting IDs.
  const panes = api("pane", "list").panes;
  const worktreePane = panes.find((pane) => pane.cwd.startsWith("/workspace/.worktrees/"));
  assert(worktreePane, "new worktree workspace is rooted in persistent storage");
  api("worktree", "remove", "--workspace", worktreePane.workspace_id);
  assert.equal(shell("git -C /workspace/herdr-repo branch --list feature/smoke"), "feature/smoke");
  exec(["env", "PI_OFFLINE=1", "node", "--input-type=module"], {
    input: readFileSync(new URL("./fixtures/check-herdr-pi.mjs", import.meta.url), "utf8"),
  });
  exec(["herdr", "server", "stop"]);
  // Server shutdown writes session.json before returning, but allow process exit.
  for (let attempt = 0; attempt < 50; attempt++) {
    if (/status: not running/.test(exec(["herdr", "status", "server"]))) break;
    await delay(100);
  }
  shell("test -s ~/.config/herdr/session.json");
  tmuxReady();
  compose(["up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--wait", "--wait-timeout", "60"]);
  tmuxReady();
  assert.match(exec(["herdr", "status", "server"]), /status: not running/);
  assert.equal(shell("sha256sum ~/.config/herdr/config.toml"), savedConfig);
  assert.equal(shell("cat ~/.local/state/herdr/canary"), "durable-state");
  exec(["env", "PI_OFFLINE=1", "node", "--input-type=module"], {
    input: readFileSync(new URL("./fixtures/check-herdr-pi.mjs", import.meta.url), "utf8"),
  });
  await startServer();
  assert(api("workspace", "list").workspaces.some((workspace) => workspace.label === "persistent-check"));
  tmuxReady();
  exec(["herdr", "server", "stop"]);
  // Populated volumes are operator-owned; missing config is not reseeded at startup.
  shell("rm ~/.config/herdr/config.toml");
  compose(["up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--wait", "--wait-timeout", "60"]);
  shell("test ! -e ~/.config/herdr/config.toml");
  tmuxReady();
  console.log("PASS: Herdr security, Pi extension, persistent config/layout/state, worktree path and tmux coexistence. No model calls.");
});
