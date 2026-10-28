// Persistent Herdr integration only: disposable project, no network/providers.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { incrementalSteps, waitFor } from "../support/acceptance.mjs";
import { composeTest } from "../support/compose-project.mjs";

/** Herdr commands for the project, which runs Pi without a network. */
const herdrCommands = (p) => {
  const compose = (args, options) => p.compose([
    "-f", "compose.yaml", "-f", "herdr-offline.yaml", ...args,
  ], options);
  const exec = (args, options) => compose(["exec", "-T", "pi-box", ...args], options);
  const serverStatus = () => exec(["herdr", "status", "server"]);
  return {
    compose,
    exec,
    shell: (command) => exec(["sh", "-ec", command]),
    api: (...args) => JSON.parse(exec(["herdr", ...args])).result,
    serverStatus,
    startServer: () => {
      compose(["exec", "-d", "pi-box", "herdr", "server"]);
      // The socket may not exist yet, so status errors count as not ready.
      return waitFor(() => /status: running/.test(serverStatus()), {
        attempts: 100, intervalMs: 100, message: "Herdr did not become ready",
      });
    },
    stopServer: () => {
      exec(["herdr", "server", "stop"]);
      // Shutdown writes session.json before returning, but allow process exit.
      return waitFor(() => /status: not running/.test(serverStatus()), {
        attempts: 50, intervalMs: 100, message: "Herdr did not stop",
      });
    },
    recreate: () => compose([
      "up", "-d", "--no-build", "--pull", "never", "--force-recreate", "--wait", "--wait-timeout", "60",
    ]),
    tmuxReady: () => exec(["tmux", "has-session", "-t", "=shell"]),
    checkPiExtension: () => exec(["env", "PI_OFFLINE=1", "node", "--input-type=module"], {
      input: readFileSync(new URL("../in-container/check-herdr-pi.mjs", import.meta.url), "utf8"),
    }),
  };
};
const test = composeTest({ name: "herdr" }).extend({
  herdr: async ({ project }, use) => use(herdrCommands(project)),
});
incrementalSteps();
let savedConfig;

test("starts offline with reduced privileges and the Herdr volume", ({ project: p, herdr: h }) => {
  writeFileSync(join(p.directory, "herdr-offline.yaml"),
    "services:\n  pi-box:\n    network_mode: none\n");
  h.compose(["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "60"]);
  const container = p.inspect(p.settings.CONTAINER);
  expect(container.Config.User).toBe("node");
  expect(container.HostConfig.NetworkMode).toBe("none");
  expect(container.HostConfig.CapDrop).toEqual(["ALL"]);
  expect(container.HostConfig.SecurityOpt).toContain("no-new-privileges:true");
  expect(container.Mounts).toHaveLength(4);
  expect(container.Mounts.find((mount) => mount.Destination === "/home/node/.herdr")?.Name)
    .toBe(p.settings.HERDR_VOLUME);
  h.tmuxReady();
});

test("startup installs the Pi reporter without starting the Herdr server", ({ herdr: h }) => {
  expect(h.serverStatus()).toMatch(/status: not running/);
  h.shell("test -s ~/.pi/agent/extensions/herdr-agent-state.ts");
});

test("workspaces and worktrees are rooted in persistent storage", async ({ herdr: h }) => {
  h.shell(`
    printf '\\n# operator canary\\n[update]\\nversion_check = false\\nmanifest_check = false\\n' >> ~/.config/herdr/config.toml
    printf durable-state > ~/.local/state/herdr/canary
    git init -b main /workspace/herdr-repo
    git -C /workspace/herdr-repo -c user.name=Smoke -c user.email=smoke@example.invalid commit --allow-empty -m initial
  `);
  savedConfig = h.shell("sha256sum ~/.config/herdr/config.toml");
  await h.startServer();
  const created = h.api("workspace", "create", "--cwd", "/workspace/herdr-repo", "--label", "persistent-check", "--no-focus");
  expect(created.root_pane.pane_id).toBeTruthy();
  expect(created.root_pane.cwd).toBe("/workspace/herdr-repo");
  expect(created.workspace.label).toBe("persistent-check");
  expect(h.api("worktree", "create", "--cwd", "/workspace/herdr-repo", "--branch", "feature/smoke", "--no-focus")).toBeTruthy();
  expect(h.exec(["git", "-C", "/workspace/herdr-repo", "worktree", "list", "--porcelain"]))
    .toMatch(/worktree \/workspace\/\.worktrees\//);
  // Find the workspace by its terminal cwd rather than predicting IDs.
  const worktreePane = h.api("pane", "list").panes
    .find((pane) => pane.cwd.startsWith("/workspace/.worktrees/"));
  expect(worktreePane, "new worktree workspace is rooted in persistent storage").toBeDefined();
  h.api("worktree", "remove", "--workspace", worktreePane.workspace_id);
  expect(h.shell("git -C /workspace/herdr-repo branch --list feature/smoke")).toBe("feature/smoke");
});

test("Pi loads the Herdr extension offline", ({ herdr: h }) => {
  h.checkPiExtension();
});

test("stopping the server saves the session alongside tmux", async ({ herdr: h }) => {
  await h.stopServer();
  h.shell("test -s ~/.config/herdr/session.json");
  h.tmuxReady();
});

test("replacement refreshes the reporter and keeps config, state and layout", async ({ herdr: h }) => {
  h.shell("printf stale > ~/.pi/agent/extensions/herdr-agent-state.ts");
  h.recreate();
  expect(h.shell("head -1 ~/.pi/agent/extensions/herdr-agent-state.ts")).toMatch(/installed by herdr/);
  h.tmuxReady();
  expect(h.serverStatus()).toMatch(/status: not running/);
  expect(h.shell("sha256sum ~/.config/herdr/config.toml")).toBe(savedConfig);
  expect(h.shell("cat ~/.local/state/herdr/canary")).toBe("durable-state");
  h.checkPiExtension();
  await h.startServer();
  expect(h.api("workspace", "list").workspaces.map((workspace) => workspace.label)).toContain("persistent-check");
  h.tmuxReady();
  await h.stopServer();
});

test("startup does not reseed config deleted from a populated volume", ({ herdr: h }) => {
  h.shell("rm ~/.config/herdr/config.toml");
  h.recreate();
  h.shell("test ! -e ~/.config/herdr/config.toml");
  h.tmuxReady();
});
