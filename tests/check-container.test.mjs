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

for (const [scenario, error] of [
  ["fresh"],
  ["normal"],
  ["standalone", /not managed by this Compose project/],
  ["inherited-labels", /not managed by this Compose project/],
  ["unsafe-git", /non-persistent/],
  ["unsafe-ssh", /non-persistent/],
  ["unsafe-link", /non-persistent/],
  ["mounts", /Unexpected mounts/],
  ["readonly", /Unexpected mounts/],
  ["bind", /Unexpected mounts/],
  ["stopped", /Start .* first/],
  ["shared-git", /in use by other/],
  ["foreign-project", /not managed by this Compose project/],
  ["foreign-service", /not managed by this Compose project/],
  ["renamed", /differently named/],
  ["legacy-pi", /Legacy Compose service pi found/],
  ["legacy-db", /Legacy Compose service db found/],
  ["bad-image", /Git volume/],
  ["bad-config", /three writable named volumes/],
  ["duplicate-volume", /must be distinct/],
  ["docker-error", /synthetic daemon error/],
  ["inspect-error", /synthetic inspection error/],
]) {
  test(`Compose preflight: ${scenario}`, () => {
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
    name: "pi-box", services: { "pi-box": {
      container_name: "pi-box-main-container", image: "pi-box:test",
      volumes: scenario === "bad-config" ? [] : volumes.map(v => ({ ...v, type: "volume" })),
    } },
    volumes: Object.fromEntries(volumes.map(v => [v.source, { name: scenario === "duplicate-volume" ? "same" : "pi-box-" + v.source }])),
  }));
} else if (args[0] === "image") {
  console.log(JSON.stringify([{ Config: { Env: scenario === "bad-image" ? [] : ["GIT_CONFIG_GLOBAL=/home/node/.config/git/config"] } }]));
} else if (args[0] === "container" && args[1] === "ls") {
  if (args.includes("--filter")) {
    if (scenario === "renamed" && args.includes("label=com.docker.compose.service=pi-box")) console.log("old-name");
    if (scenario === "legacy-pi" && args.includes("label=com.docker.compose.service=pi")) console.log("legacy-dev");
    if (scenario === "legacy-db" && args.includes("label=com.docker.compose.service=db")) console.log("legacy-postgres");
  } else if (scenario !== "fresh") console.log("pi-box-main-container");
} else if (args[0] === "container" && args[1] === "inspect") {
  if (scenario === "inspect-error") { console.error("synthetic inspection error"); process.exit(1); }
  console.log(JSON.stringify([{
    Id: "synthetic-container-id",
    Config: { Labels: scenario === "standalone" ? {} : {
      ...(scenario === "inherited-labels" ? {} : { "com.docker.compose.config-hash": "synthetic-hash" }),
      "com.docker.compose.project": scenario === "foreign-project" ? "other" : "pi-box",
      "com.docker.compose.service": scenario === "foreign-service" ? "other" : "pi-box",
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
        ["scripts/check-container.mjs"],
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
      for (const service of ["pi", "db"]) {
        const legacyCheck = calls.find((args) =>
          args.includes(`label=com.docker.compose.service=${service}`),
        );
        if (legacyCheck) assert.ok(legacyCheck.includes("--all"), "check stopped legacy containers too");
        if (["fresh", "normal"].includes(scenario)) assert.ok(legacyCheck, `check legacy service ${service}`);
      }
      const mutations = calls.filter((args) =>
        ["stop", "rm", "run", "volume"].includes(args[0]),
      );
      assert.deepEqual(mutations, [], "preflight must always be read-only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("Make checks before Compose up/replace and uses Compose for attachment", () => {
  for (const target of ["up", "replace", "attach"]) {
    const result = spawnSync("make", ["-n", target], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split("\n");
    const up = lines.findIndex((line) => line.startsWith("docker compose up "));
    if (target === "attach") {
      assert.match(result.stdout, /docker compose exec pi-box tmux attach-session/);
    } else {
      const check = lines.indexOf("node scripts/check-container.mjs");
      assert.ok(check >= 0 && check < up, result.stdout);
      assert.match(lines[up], /--no-build --pull (never|missing)/);
      if (target === "replace")
        assert.match(lines[up], /--no-deps --force-recreate/);
    }
  }
});
