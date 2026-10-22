#!/usr/bin/env node
// No .env loading: Compose credentials must never become sandbox build inputs.
import { spawnSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const buildInputs = [
  ["sandbox/pi-box.yaml", "pi-box.yaml"],
  ["sandbox/pi-box.dockerfile", "pi-box.dockerfile"],
  ...["package.json", "package-lock.json", "prepare-runtime.mjs", "init-agent.mjs"]
    .map((name) => [`container/${name}`, `runtime/${name}`]),
];

/** Copy only reviewed regular files; never send the checkout or secrets to a builder. */
export function stageKit(source = root) {
  const parent = mkdtempSync(join(tmpdir(), "pi-box-kit-"));
  const directory = join(parent, "pi-box");
  mkdirSync(directory);
  try {
    for (const [from, to] of buildInputs) {
      if (!lstatSync(join(source, from)).isFile()) {
        throw new Error(`Build input must be a regular file, not a symlink: ${from}`);
      }
      const target = join(directory, to);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(source, from), target);
    }
    return directory;
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function invoke(args, capture = false) {
  const result = spawnSync("sbx", args, {
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(capture ? result.stderr.trim() : `sbx ${args[0]} failed (${result.status})`);
  }
  return result.stdout;
}

export function main(action, env = process.env, run = invoke) {
  const name = env.SANDBOX_NAME || "pi-box";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(name) || name === "default") {
    throw new Error("Invalid SANDBOX_NAME");
  }
  if (!["create", "start", "shell", "status", "stop", "validate"].includes(action)) {
    throw new Error("Usage: node scripts/sandbox.mjs create|start|shell|status|stop|validate");
  }
  if (action === "status") return run(["ls"]);
  if (action === "validate") {
    const kit = stageKit();
    try { return run(["kit", "validate", kit]); }
    finally { rmSync(dirname(kit), { recursive: true, force: true }); }
  }
  const sandboxes = JSON.parse(run(["ls", "--format", "json"], true));
  if (!Array.isArray(sandboxes)) throw new Error("Unexpected sbx ls response");
  const existing = sandboxes.find((sandbox) => sandbox.name === name);
  if (action === "create") {
    if (existing) throw new Error(`Sandbox ${name} already exists; open a shell or start it instead. No recreation performed.`);
    // Forwarding is host-global in sbx, not a per-kit opt-out. Fail closed.
    if (run(["settings", "get", "ssh.agentForwardingEnabled"], true).trim() !== "false") {
      throw new Error("Disable SSH-agent forwarding on the host before creation: sbx settings set ssh.agentForwardingEnabled false; sbx daemon restart");
    }
    const kit = stageKit();
    try {
      // v0.49.2 builds v3 workloads but rejects custom agent names at launch.
      // Use its built-in shell identity with the compiled image. Networking
      // follows host policy; no project access mixin or model credentials.
      const compiled = JSON.parse(run(["kit", "inspect", kit, "--format", "json"], true));
      if (!compiled.sandbox?.image || !compiled.sandbox.resources?.cpu || !compiled.sandbox.resources?.memory) {
        throw new Error("Kit build returned no image or resource limits");
      }
      return run(["create", "--name", name, "--skills", "off",
        "--cpus", String(compiled.sandbox.resources.cpu), "--memory", compiled.sandbox.resources.memory,
        "--pull", "never", "--template", compiled.sandbox.image, "shell"]);
    } finally { rmSync(dirname(kit), { recursive: true, force: true }); }
  }
  // Never let `sbx run` create a missing name and implicitly share cwd.
  if (!existing) throw new Error(`Sandbox ${name} does not exist; run sandbox-create first.`);
  if (action === "stop") return run(["stop", name]);
  if (action === "start") return run(["run", "--detach", "--name", name]);
  return run(["exec", "-it", name, "bash", "-l"]);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(process.argv[2]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
