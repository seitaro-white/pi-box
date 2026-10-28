import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect } from "vitest";
import { test as base } from "../support/fixtures.mjs";
import { root } from "../support/files.mjs";

const container = "pi-box-main-container";
const volumes = [
  { source: "workspace", target: "/workspace" },
  { source: "agent", target: "/home/node/.pi/agent" },
  { source: "git", target: "/home/node/.config/git" },
  { source: "herdr", target: "/home/node/.herdr" },
];
const readOnlyCommands = [
  "compose config", "image inspect", "container ls", "container inspect", "ps --filter",
];

/** What the fake docker reports: a healthy, running, Compose-managed Pi Box. */
function healthyDocker() {
  return {
    config: {
      name: "pi-box",
      services: {
        "pi-box": {
          container_name: container,
          image: "pi-box:test",
          volumes: volumes.map((volume) => ({ ...volume, type: "volume" })),
        },
      },
      volumes: Object.fromEntries(
        volumes.map(({ source }) => [source, { name: `pi-box-${source}` }]),
      ),
    },
    image: [{ Config: { Env: ["GIT_CONFIG_GLOBAL=/home/node/.config/git/config"] } }],
    owned: [container],
    names: [container],
    existing: [{
      Config: { Labels: {
        "com.docker.compose.config-hash": "synthetic-hash",
        "com.docker.compose.project": "pi-box",
        "com.docker.compose.service": "pi-box",
      } },
      State: { Running: true },
      Mounts: volumes.map(({ source, target }) => ({
        Type: "volume", RW: true, Name: `pi-box-${source}`, Destination: target,
      })),
    }],
    users: {},
    // Optional file created in the container home before the check runs.
    unsafePath: undefined,
  };
}

const test = base.extend({
  /**
   * Run scripts/check-container.mjs against a fake docker CLI on PATH.
   * Tests edit `preflight.docker` first; `run()` also checks the preflight
   * only issued read-only commands and left Git config untouched.
   */
  preflight: async ({ tmpDir }, use) => {
    const docker = healthyDocker();
    const home = join(tmpDir, "home");
    const log = join(tmpDir, "calls");
    const gitConfig = join(home, ".config/git/config");
    mkdirSync(join(home, ".config/git"), { recursive: true });
    writeFileSync(gitConfig, "[user]\nname = Synthetic\n");
    writeFileSync(
      join(tmpDir, "docker"),
      `#!/bin/sh\nexec "${process.execPath}" "${join(root, "tests/support/fake-docker.cjs")}" "$@"\n`,
      { mode: 0o755 },
    );

    const run = () => {
      if (docker.unsafePath === ".git-credentials") {
        // Dangling links must also block replacement.
        symlinkSync("missing", join(home, docker.unsafePath));
      } else if (docker.unsafePath) {
        writeFileSync(join(home, docker.unsafePath), "SYNTHETIC");
      }
      writeFileSync(join(tmpDir, "fixture.json"), JSON.stringify(docker));
      const result = spawnSync(process.execPath, ["scripts/check-container.mjs"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${tmpDir}:${process.env.PATH}`,
          FIXTURE: join(tmpDir, "fixture.json"),
          LOG: log,
          TEST_HOME: home,
        },
      });
      const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
      for (const args of calls) {
        if (args[0] === "exec") {
          expect(args).toEqual(["exec", "-i", container, "sh", "-s"]);
        } else {
          expect(readOnlyCommands, "preflight must be read-only").toContain(args.slice(0, 2).join(" "));
        }
      }
      expect(readFileSync(gitConfig, "utf8")).toBe("[user]\nname = Synthetic\n");
      return { result, calls };
    };
    await use({ docker, run });
  },
});

describe("Compose preflight", () => {
  test.for([
    { scenario: "fresh", change: (docker) => { docker.names = []; docker.owned = []; } },
    { scenario: "running", change: () => {} },
  ])("passes for a $scenario project", ({ scenario, change }, { preflight }) => {
    change(preflight.docker);
    const { result, calls } = preflight.run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Preflight passed/);
    const owned = calls.find((args) => args.includes("label=com.docker.compose.service=pi-box"));
    expect(owned, "check stopped project containers too").toContain("--all");
    expect(owned).toContain("label=com.docker.compose.project=pi-box");
    expect(owned).toContain("label=com.docker.compose.config-hash");
    // Disposable files can only be checked inside an existing container.
    expect(calls.some((args) => args[0] === "exec")).toBe(scenario !== "fresh");
    for (const { source } of volumes) {
      expect(calls).toContainEqual(expect.arrayContaining(["ps", `volume=pi-box-${source}`]));
    }
  });

  test.for([
    { scenario: "a pre-Herdr container", change: (d) => { d.existing[0].Mounts.pop(); }, error: /Unexpected mounts/ },
    { scenario: "a standalone container", change: (d) => { d.existing[0].Config.Labels = {}; }, error: /not managed by this Compose project/ },
    {
      scenario: "labels inherited from an image",
      change: (d) => { delete d.existing[0].Config.Labels["com.docker.compose.config-hash"]; },
      error: /not managed by this Compose project/,
    },
    ...[".gitconfig", ".ssh", ".git-credentials"].map((path) => ({
      scenario: `non-persistent ~/${path}`, change: (d) => { d.unsafePath = path; }, error: /non-persistent/,
    })),
    { scenario: "a missing mount", change: (d) => { d.existing[0].Mounts.splice(1, 1); }, error: /Unexpected mounts/ },
    { scenario: "a read-only mount", change: (d) => { d.existing[0].Mounts[0].RW = false; }, error: /Unexpected mounts/ },
    { scenario: "a bind mount", change: (d) => { d.existing[0].Mounts[0].Type = "bind"; }, error: /Unexpected mounts/ },
    { scenario: "a stopped container", change: (d) => { d.existing[0].State.Running = false; }, error: /Start .* first/ },
    { scenario: "a shared Git volume", change: (d) => { d.users["volume=pi-box-git"] = ["other"]; }, error: /in use by other/ },
    { scenario: "a shared Herdr volume", change: (d) => { d.users["volume=pi-box-herdr"] = ["other"]; }, error: /in use by other/ },
    {
      scenario: "a foreign project",
      change: (d) => { d.existing[0].Config.Labels["com.docker.compose.project"] = "other"; },
      error: /not managed by this Compose project/,
    },
    {
      scenario: "a foreign service",
      change: (d) => { d.existing[0].Config.Labels["com.docker.compose.service"] = "other"; },
      error: /not managed by this Compose project/,
    },
    { scenario: "a renamed container", change: (d) => { d.owned = ["old-name"]; }, error: /differently named/ },
    { scenario: "an image without Git volume support", change: (d) => { d.image[0].Config.Env = []; }, error: /Git volume/ },
    {
      scenario: "invalid Compose mounts",
      change: (d) => { d.config.services["pi-box"].volumes = []; },
      error: /four writable named volumes/,
    },
    { scenario: "a duplicate volume", change: (d) => { d.config.volumes.git.name = "pi-box-agent"; }, error: /must be distinct/ },
  ])("refuses $scenario", ({ change, error }, { preflight }) => {
    change(preflight.docker);
    const { result } = preflight.run();

    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toMatch(error);
  });
});

describe.for(["up", "replace"])("make %s", (target) => {
  test("runs the preflight before Compose", () => {
    const result = spawnSync("make", ["-n", target], { encoding: "utf8" });
    expect(result.error?.message, "make must be installed").toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.split("\n");
    const up = lines.findIndex((line) => line.startsWith("docker compose up "));
    const check = lines.indexOf("node scripts/check-container.mjs");
    expect(check, result.stdout).toBeGreaterThanOrEqual(0);
    expect(check, result.stdout).toBeLessThan(up);
    expect(lines[up]).toMatch(/--no-build --pull (never|missing)/);
    if (target === "replace") expect(lines[up]).toMatch(/--no-deps --force-recreate/);
  });
});
