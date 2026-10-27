// Persistent Herdr integration only: disposable project, no network/providers.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "./helpers/acceptance.mjs";
import { composeSuite } from "./helpers/compose-project.mjs";

composeSuite("Herdr", { name: "herdr" }, (p, step) => {
  const compose = (args, options) => p.compose([
    "-f", "compose.yaml", "-f", "herdr-offline.yaml", ...args,
  ], options);
  const exec = (args, options) => compose(["exec", "-T", "pi-box", ...args], options);
  const shell = (command) => exec(["sh", "-ec", command]);
  const api = (...args) => JSON.parse(exec(["herdr", ...args])).result;
  const serverStatus = () => exec(["herdr", "status", "server"]);
  const startServer = () => {
    compose(["exec", "-d", "pi-box", "herdr", "server"]);
    // The socket may not exist yet, so status errors count as not ready.
    return waitFor(() => /status: running/.test(serverStatus()), {
      attempts: 100, intervalMs: 100, message: "Herdr did not become ready",
    });
  };
  const stopServer = () => {
    exec(["herdr", "server", "stop"]);
    // Shutdown writes session.json before returning, but allow process exit.
    return waitFor(() => /status: not running/.test(serverStatus()), {
      attempts: 50, intervalMs: 100, message: "Herdr did not stop",
    });
  };
  const recreate = () => compose([
    "up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--wait", "--wait-timeout", "60",
  ]);
  const tmuxReady = () => exec(["tmux", "has-session", "-t", "=shell"]);
  const checkPiExtension = () => exec(["env", "PI_OFFLINE=1", "node", "--input-type=module"], {
    input: readFileSync(new URL("./fixtures/check-herdr-pi.mjs", import.meta.url), "utf8"),
  });
  let savedConfig;

  step("starts offline with reduced privileges and the Herdr volume", () => {
    writeFileSync(join(p.directory, "herdr-offline.yaml"),
      "services:\n  pi-box:\n    network_mode: none\n");
    compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60"]);
    const container = p.inspect(p.settings.CONTAINER);
    assert.equal(container.Config.User, "node");
    assert.equal(container.HostConfig.NetworkMode, "none");
    assert.deepEqual(container.HostConfig.CapDrop, ["ALL"]);
    assert(container.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
    assert.equal(container.Mounts.length, 4);
    assert.equal(container.Mounts.find((mount) => mount.Destination === "/home/node/.herdr")?.Name, p.settings.HERDR_VOLUME);
    tmuxReady();
  });

  step("startup installs the Pi reporter without starting the Herdr server", () => {
    assert.match(serverStatus(), /status: not running/);
    shell("test -s ~/.pi/agent/extensions/herdr-agent-state.ts");
  });

  step("workspaces and worktrees are rooted in persistent storage", async () => {
    shell(`
      printf '\\n# operator canary\\n[update]\\nversion_check = false\\nmanifest_check = false\\n' >> ~/.config/herdr/config.toml
      printf durable-state > ~/.local/state/herdr/canary
      git init -b main /workspace/herdr-repo
      git -C /workspace/herdr-repo -c user.name=Smoke -c user.email=smoke@example.invalid commit --allow-empty -m initial
    `);
    savedConfig = shell("sha256sum ~/.config/herdr/config.toml");
    await startServer();
    const created = api("workspace", "create", "--cwd", "/workspace/herdr-repo", "--label", "persistent-check", "--no-focus");
    assert(created.root_pane.pane_id);
    assert.equal(created.root_pane.cwd, "/workspace/herdr-repo");
    assert.equal(created.workspace.label, "persistent-check");
    assert(api("worktree", "create", "--cwd", "/workspace/herdr-repo", "--branch", "feature/smoke", "--no-focus"));
    const listing = exec(["git", "-C", "/workspace/herdr-repo", "worktree", "list", "--porcelain"]);
    assert.match(listing, /worktree \/workspace\/\.worktrees\//);
    // Find the workspace by its terminal cwd rather than predicting IDs.
    const worktreePane = api("pane", "list").panes
      .find((pane) => pane.cwd.startsWith("/workspace/.worktrees/"));
    assert(worktreePane, "new worktree workspace is rooted in persistent storage");
    api("worktree", "remove", "--workspace", worktreePane.workspace_id);
    assert.equal(shell("git -C /workspace/herdr-repo branch --list feature/smoke"), "feature/smoke");
  });

  step("Pi loads the Herdr extension offline", () => {
    checkPiExtension();
  });

  step("stopping the server saves the session alongside tmux", async () => {
    await stopServer();
    shell("test -s ~/.config/herdr/session.json");
    tmuxReady();
  });

  step("replacement refreshes the reporter and keeps config, state and layout", async () => {
    shell("printf stale > ~/.pi/agent/extensions/herdr-agent-state.ts");
    recreate();
    assert.match(shell("head -1 ~/.pi/agent/extensions/herdr-agent-state.ts"), /installed by herdr/);
    tmuxReady();
    assert.match(serverStatus(), /status: not running/);
    assert.equal(shell("sha256sum ~/.config/herdr/config.toml"), savedConfig);
    assert.equal(shell("cat ~/.local/state/herdr/canary"), "durable-state");
    checkPiExtension();
    await startServer();
    assert(api("workspace", "list").workspaces.some((workspace) => workspace.label === "persistent-check"));
    tmuxReady();
    await stopServer();
  });

  step("startup does not reseed config deleted from a populated volume", () => {
    shell("rm ~/.config/herdr/config.toml");
    recreate();
    shell("test ! -e ~/.config/herdr/config.toml");
    tmuxReady();
  });
});
