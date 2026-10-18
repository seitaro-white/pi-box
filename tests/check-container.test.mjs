import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const volumes = [
  { source: "workspace", target: "/workspace" },
  { source: "agent", target: "/home/node/.pi/agent" },
  { source: "git", target: "/home/node/.config/git" },
];

for (const [scenario, mode, error] of [
  ["fresh", "check"],
  ["normal", "check"],
  ["normal", "migrate"],
  ["legacy", "check", /make migrate/],
  ["legacy", "migrate"],
  ["inherited-labels", "check", /make migrate/],
  ["inherited-labels", "migrate"],
  ["unsafe-git", "migrate", /non-persistent/],
  ["unsafe-ssh", "check", /non-persistent/],
  ["unsafe-link", "check", /non-persistent/],
  ["mounts", "check", /Unexpected mounts/],
  ["readonly", "check", /Unexpected mounts/],
  ["bind", "check", /Unexpected mounts/],
  ["stopped", "migrate", /Start .* first/],
  ["shared-git", "migrate", /in use by other/],
  ["foreign-project", "migrate", /another Compose project/],
  ["foreign-service", "check", /another Compose project/],
  ["renamed", "check", /differently named/],
  ["bad-image", "check", /Git volume/],
  ["bad-config", "check", /three writable named volumes/],
  ["duplicate-volume", "check", /must be distinct/],
  ["docker-error", "check", /synthetic daemon error/],
  ["inspect-error", "check", /synthetic inspection error/],
]) {
  test(`Compose preflight: ${scenario} (${mode})`, () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-box-preflight-"));
    try {
      const home = join(dir, "home");
      const log = join(dir, "calls");
      mkdirSync(join(home, ".config/git"), { recursive: true });
      writeFileSync(
        join(home, ".config/git/config"),
        "[user]\nname = Synthetic\n",
      );
      const unsafe = { "unsafe-git": ".gitconfig", "unsafe-ssh": ".ssh" }[
        scenario
      ];
      if (unsafe) writeFileSync(join(home, unsafe), "SYNTHETIC");
      if (scenario === "unsafe-link") {
        // Create a dangling link: it must still block replacement.
        const result = spawnSync("ln", [
          "-s",
          "missing",
          join(home, ".git-credentials"),
        ]);
        assert.equal(result.status, 0);
      }
      writeFileSync(
        join(dir, "docker"),
        `#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const scenario = process.env.SCENARIO;
const volumes = ${JSON.stringify(volumes)};
fs.appendFileSync(process.env.LOG, JSON.stringify(args) + "\\n");
if (scenario === "docker-error") {
  console.error("synthetic daemon error"); process.exit(1);
}
if (args[0] === "compose") {
  console.log(JSON.stringify({
    name: "pi-box", services: { pi: {
      container_name: "pi-box-dev", image: "pi-box:test",
      volumes: scenario === "bad-config" ? [] : volumes.map(v => ({ ...v, type: "volume" })),
    } },
    volumes: Object.fromEntries(volumes.map(v => [v.source, { name: scenario === "duplicate-volume" ? "same" : "pi-box-" + v.source }])),
  }));
} else if (args[0] === "image") {
  console.log(JSON.stringify([{ Config: { Env: scenario === "bad-image" ? [] : ["GIT_CONFIG_GLOBAL=/home/node/.config/git/config"] } }]));
} else if (args[0] === "container" && args[1] === "ls") {
  if (args.includes("--filter")) {
    if (scenario === "renamed") console.log("old-name");
  } else if (scenario !== "fresh") console.log("pi-box-dev");
} else if (args[0] === "container" && args[1] === "inspect") {
  if (scenario === "inspect-error") { console.error("synthetic inspection error"); process.exit(1); }
  console.log(JSON.stringify([{
    Id: "synthetic-container-id",
    Config: { Labels: scenario === "legacy" || scenario === "unsafe-git" ? {} : {
      ...(scenario === "inherited-labels" ? {} : { "com.docker.compose.config-hash": "synthetic-hash" }),
      "com.docker.compose.project": scenario === "foreign-project" ? "other" : "pi-box",
      "com.docker.compose.service": scenario === "foreign-service" ? "other" : "pi",
    } },
    State: { Running: scenario !== "stopped" },
    Mounts: (scenario === "mounts" ? volumes.slice(0, 2) : volumes).map(v => ({
      Type: scenario === "bind" ? "bind" : "volume", RW: scenario !== "readonly",
      Name: "pi-box-" + v.source, Destination: v.target,
    })),
  }]));
} else if (args[0] === "exec") {
  const script = fs.readFileSync(0, "utf8").replaceAll("/home/node", process.env.TEST_HOME);
  const result = spawnSync("sh", ["-s"], { input: script, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(result.status ?? 1);
} else if (args[0] === "ps" && scenario === "shared-git" && args.includes("volume=pi-box-git")) {
  console.log("other");
}
`,
        { mode: 0o755 },
      );
      const result = spawnSync(
        process.execPath,
        ["scripts/check-container.mjs", mode],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            SCENARIO: scenario,
            LOG: log,
            TEST_HOME: home,
          },
        },
      );
      assert.equal(result.status, error ? 1 : 0, result.stderr);
      if (error) assert.match(result.stderr, error);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse);
      const mutations = calls.filter((args) =>
        ["stop", "rm", "run", "volume"].includes(args[0]),
      );
      assert.deepEqual(
        mutations,
        ["legacy", "inherited-labels"].includes(scenario) && mode === "migrate"
          ? [
              ["stop", "synthetic-container-id"],
              ["rm", "synthetic-container-id"],
            ]
          : [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Make checks before Compose up/replace and uses Compose for attachment", () => {
  for (const target of ["up", "replace", "migrate", "attach"]) {
    const result = spawnSync("make", ["-n", target], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split("\n");
    const up = lines.findIndex((line) => line.startsWith("docker compose up "));
    if (target === "attach") {
      assert.match(result.stdout, /docker compose exec pi tmux attach-session/);
    } else {
      const check = lines.findIndex(
        (line) =>
          line ===
          `node scripts/check-container.mjs ${target === "migrate" ? "migrate" : "check"}`,
      );
      assert.ok(check >= 0 && check < up, result.stdout);
      assert.match(lines[up], /--no-build --pull (never|missing)/);
      if (target === "replace")
        assert.match(lines[up], /--no-deps --force-recreate/);
    }
  }
});
