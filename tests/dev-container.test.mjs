import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const {
  scenario,
  profile = "recommended",
  status = 0,
} of [
  { scenario: "normal" },
  { scenario: "base", profile: "base" },
  { scenario: "unsafe-git", status: 1 },
  { scenario: "unsafe-ssh", status: 1 },
  { scenario: "mounts", status: 1 },
  { scenario: "shared-git", status: 1 },
]) {
  test(`container lifecycle: ${scenario}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-box-lifecycle-"));
    try {
      const log = join(dir, "calls");
      const home = join(dir, "home");
      mkdirSync(join(home, ".config/git"), { recursive: true });

      // Normal persistent Git state must not trigger the disposable-file guard.
      writeFileSync(
        join(home, ".config/git/config"),
        "[user]\nname = Synthetic\n",
      );
      if (scenario === "unsafe-git") {
        writeFileSync(join(home, ".gitconfig"), "SYNTHETIC_CONFIG");
      }
      if (scenario === "unsafe-ssh") {
        mkdirSync(join(home, ".ssh"));
      }

      // A disposable Docker stub records calls and runs the real file check
      // against temporary files. No live container or credentials are accessed.
      writeFileSync(
        join(dir, "docker"),
        `#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const scenario = process.env.SCENARIO;
fs.appendFileSync(process.env.LOG, JSON.stringify(args) + "\\n");

if (args[0] === "image") {
  console.log(JSON.stringify([
    { Config: { Env: [
      "GIT_CONFIG_GLOBAL=/home/node/.config/git/config",
      "PI_BOX_PROFILE=" + process.env.PROFILE,
    ] } },
  ]));
} else if (args[0] === "container" && args[1] === "ls") {
  console.log("pi-box-dev");
} else if (args[0] === "container" && args[1] === "inspect") {
  const mounts = [
    {
      Type: "volume",
      Name: "pi-box-agent",
      Destination: "/home/node/.pi/agent",
    },
    {
      Type: "volume",
      Name: "pi-box-workspace",
      Destination: "/workspace",
    },
  ];
  if (scenario !== "mounts") {
    mounts.push({
      Type: "volume",
      Name: "pi-box-git",
      Destination: "/home/node/.config/git",
    });
  }
  console.log(JSON.stringify([{ Mounts: mounts, State: { Running: true } }]));
} else if (args[0] === "exec" && args.includes("sh")) {
  const script = fs
    .readFileSync(0, "utf8")
    .replaceAll("/home/node", process.env.TEST_HOME);
  const result = spawnSync("sh", ["-s"], {
    input: script,
    stdio: ["pipe", "inherit", "inherit"],
  });
  process.exit(result.status ?? 1);
} else if (
  args[0] === "ps" &&
  scenario === "shared-git" &&
  args.includes("volume=pi-box-git")
) {
  console.log("other");
}
`,
        { mode: 0o755 },
      );

      const result = spawnSync(
        process.execPath,
        ["scripts/dev-container.mjs", "replace"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            LOG: log,
            SCENARIO: scenario,
            PROFILE: profile,
            TEST_HOME: home,
            IMAGE: "pi-box:0.2.0",
            CONTAINER: "pi-box-dev",
            WORKSPACE_VOLUME: "pi-box-workspace",
            AGENT_VOLUME: "pi-box-agent",
            GIT_VOLUME: "pi-box-git",
          },
        },
      );
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.equal(result.status, status, result.stderr);
      for (const action of ["stop", "rm", "run"]) {
        assert.equal(
          calls.some((args) => args[0] === action),
          status === 0,
        );
      }
      if (status === 0) {
        const run = calls.find((args) => args[0] === "run");
        assert.ok(run.includes("pi-box-git:/home/node/.config/git"));
        for (const flag of ["--publish", "-p", "--publish-all", "-P"]) {
          assert.ok(!run.includes(flag), `no port publishing via ${flag}`);
        }
      }
      assert.ok(
        !calls.some((args) => args[0] === "volume" && args[1] === "rm"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
