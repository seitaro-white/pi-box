import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { temporaryDirectory } from "./helpers/files.mjs";

const container = "pi-box-main-container";
const volumes = [
  { source: "workspace", target: "/workspace" },
  { source: "agent", target: "/home/node/.pi/agent" },
  { source: "git", target: "/home/node/.config/git" },
  { source: "herdr", target: "/home/node/.herdr" },
];

function preflightFixture() {
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
  };
}

// Only command routing runs in the fake executable; policy scenarios stay here.
function runPreflight(t, fixture) {
  const dir = temporaryDirectory(t, "pi-box-preflight-");
  const home = join(dir, "home");
  const log = join(dir, "calls");
  mkdirSync(join(home, ".config/git"), { recursive: true });
  const gitConfig = join(home, ".config/git/config");
  writeFileSync(gitConfig, "[user]\nname = Synthetic\n");
  if (fixture.unsafePath === ".git-credentials") {
    // Dangling links must also block replacement.
    symlinkSync("missing", join(home, fixture.unsafePath));
  } else if (fixture.unsafePath) {
    writeFileSync(join(home, fixture.unsafePath), "SYNTHETIC");
  }
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  writeFileSync(join(dir, "docker"), String.raw`#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
fs.appendFileSync(process.env.LOG, JSON.stringify(args) + "\n");
let output;
switch (args.slice(0, 2).join(" ")) {
  case "compose config": output = fixture.config; break;
  case "image inspect": output = fixture.image; break;
  case "container ls": output = (args.includes("--filter") ? fixture.owned : fixture.names).join("\n"); break;
  case "container inspect": output = fixture.existing; break;
  case "ps --filter": output = (fixture.users[args[2]] || []).join("\n"); break;
  case "exec -i": {
    const script = fs.readFileSync(0, "utf8").replaceAll("/home/node", process.env.TEST_HOME);
    const result = spawnSync("sh", ["-s"], { input: script, stdio: ["pipe", "inherit", "inherit"] });
    process.exit(result.status ?? 1);
  }
  default: throw new Error("Unexpected Docker command: " + args.join(" "));
}
console.log(typeof output === "string" ? output : JSON.stringify(output));
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, ["scripts/check-container.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      FIXTURE: join(dir, "fixture.json"),
      LOG: log,
      TEST_HOME: home,
    },
  });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  for (const args of calls) {
    if (args[0] === "exec") {
      assert.deepEqual(args, ["exec", "-i", container, "sh", "-s"]);
    } else {
      assert.ok([
        "compose config", "image inspect", "container ls", "container inspect", "ps --filter",
      ].includes(args.slice(0, 2).join(" ")), `preflight must be read-only: ${args}`);
    }
  }
  assert.equal(readFileSync(gitConfig, "utf8"), "[user]\nname = Synthetic\n");
  return { result, calls };
}

for (const [scenario, change, error] of [
  ["fresh", (fixture) => { fixture.names = []; fixture.owned = []; }],
  ["normal", () => {}],
  ["add Herdr volume", (fixture) => { fixture.existing[0].Mounts.pop(); }],
  [
    "unmounted Herdr data",
    (fixture) => { fixture.existing[0].Mounts.pop(); fixture.unsafePath = ".herdr"; },
    /non-persistent.*herdr/,
  ],
  [
    "standalone",
    (fixture) => { fixture.existing[0].Config.Labels = {}; },
    /not managed by this Compose project/,
  ],
  [
    "inherited-labels",
    (fixture) => { delete fixture.existing[0].Config.Labels["com.docker.compose.config-hash"]; },
    /not managed by this Compose project/,
  ],
  ...[".gitconfig", ".ssh", ".git-credentials"].map((path) => [
    `non-persistent ${path}`, (fixture) => { fixture.unsafePath = path; }, /non-persistent/,
  ]),
  ["missing mount", (fixture) => { fixture.existing[0].Mounts.splice(1, 1); }, /Unexpected mounts/],
  ["readonly mount", (fixture) => { fixture.existing[0].Mounts[0].RW = false; }, /Unexpected mounts/],
  ["bind mount", (fixture) => { fixture.existing[0].Mounts[0].Type = "bind"; }, /Unexpected mounts/],
  ["stopped", (fixture) => { fixture.existing[0].State.Running = false; }, /Start .* first/],
  ["shared Git volume", (fixture) => { fixture.users["volume=pi-box-git"] = ["other"]; }, /in use by other/],
  ["shared Herdr volume", (fixture) => { fixture.users["volume=pi-box-herdr"] = ["other"]; }, /in use by other/],
  [
    "foreign project",
    (fixture) => { fixture.existing[0].Config.Labels["com.docker.compose.project"] = "other"; },
    /not managed by this Compose project/,
  ],
  [
    "foreign service",
    (fixture) => { fixture.existing[0].Config.Labels["com.docker.compose.service"] = "other"; },
    /not managed by this Compose project/,
  ],
  ["renamed", (fixture) => { fixture.owned = ["old-name"]; }, /differently named/],
  ["image without Git volume support", (fixture) => { fixture.image[0].Config.Env = []; }, /Git volume/],
  [
    "invalid Compose mounts",
    (fixture) => { fixture.config.services["pi-box"].volumes = []; },
    /four writable named volumes/,
  ],
  [
    "duplicate volume",
    (fixture) => { fixture.config.volumes.git.name = "pi-box-agent"; },
    /must be distinct/,
  ],
]) {
  test(`Compose preflight: ${scenario}`, (t) => {
    const fixture = preflightFixture();
    change(fixture);
    const { result, calls } = runPreflight(t, fixture);
    assert.equal(result.status, error ? 1 : 0, result.stderr);
    if (error) assert.match(result.stderr, error);
    else {
      assert.match(result.stdout, /Preflight passed/);
      const owned = calls.find((args) => args.includes("label=com.docker.compose.service=pi-box"));
      assert.ok(owned?.includes("--all"), "check stopped project containers too");
      assert.ok(owned.includes("label=com.docker.compose.project=pi-box"));
      assert.ok(owned.includes("label=com.docker.compose.config-hash"));
      assert.equal(calls.some((args) => args[0] === "exec"), scenario !== "fresh");
      for (const { source } of volumes) {
        assert.ok(calls.some((args) => args[0] === "ps" && args.includes(`volume=pi-box-${source}`)));
      }
    }
  });
}

test("Make checks before Compose up/replace", () => {
  for (const target of ["up", "replace"]) {
    const result = spawnSync("make", ["-n", target], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.split("\n");
    const up = lines.findIndex((line) => line.startsWith("docker compose up "));
    const check = lines.indexOf("node scripts/check-container.mjs");
    assert.ok(check >= 0 && check < up, result.stdout);
    assert.match(lines[up], /--no-build --pull (never|missing)/);
    if (target === "replace")
      assert.match(lines[up], /--no-deps --force-recreate/);
  }
});
