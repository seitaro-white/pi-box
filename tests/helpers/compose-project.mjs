import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./engine.mjs";

/**
 * Run acceptance against public Make/Compose files in a private, disposable project.
 * Commands capture output (even with inherit requested) so failures can be redacted.
 * extraOptions accepts the same input/env/cwd/timeout options as runCommand.
 */
export async function withComposeProject({ name, overlays = [], settings = {} }, run) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const project = `pi-box-${name}-${randomUUID()}`;
  const directory = mkdtempSync(join(tmpdir(), `${project}-`));
  const localSettings = {
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    BROWSER_TOKEN: randomBytes(32).toString("hex"),
    PHOENIX_UI_PORT: "0",
    ...settings,
    COMPOSE_FILE: ["compose.yaml", ...overlays].join(":"),
    COMPOSE_PROJECT_NAME: project,
    CONTAINER: project,
    IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
    TARGET: "recommended",
    WORKSPACE_VOLUME: `${project}-workspace`,
    AGENT_VOLUME: `${project}-agent`,
    GIT_VOLUME: `${project}-git`,
    HERDR_VOLUME: `${project}-herdr`,
  };
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("COMPOSE_") || key in localSettings ||
        ["MAKEFLAGS", "MFLAGS", "MAKEFILES"].includes(key)) delete env[key];
  }
  const secrets = Object.entries(localSettings)
    .filter(([key]) => /PASSWORD|TOKEN|SECRET|API_KEY/.test(key))
    .flatMap(([, value]) => [String(value), encodeURIComponent(String(value))])
    .filter(Boolean);
  const redact = (text) => secrets.reduce(
    (output, secret) => output.split(secret).join("[REDACTED]"), String(text),
  );
  const command = (executable, args, extraOptions = {}) => {
    try {
      return runCommand(executable, args, {
        cwd: directory, env, timeout: 300_000, ...extraOptions, inherit: false,
      });
    } catch (error) {
      throw new Error(redact(error.message));
    }
  };
  const docker = (args, extraOptions) => command("docker", args, extraOptions);
  const compose = (args, extraOptions) => docker(["compose", ...args], extraOptions);
  const p = {
    root, directory, project, settings: localSettings, docker, compose,
    make: (target) => command("make", ["-o", "build", target]),
    config: (files = []) => JSON.parse(compose([
      ...files.flatMap((file) => ["-f", file]), "config", "--format", "json",
    ])),
    inspect: (id) => JSON.parse(docker(["inspect", id]))[0],
  };
  let failure;
  let result;
  let ready = false;
  function cleanup(failed) {
    if (failed && process.env.PI_BOX_KEEP_TEST_RESOURCES === "1") {
      console.error(`Retained failed project ${project}: ${directory}; volumes ${localSettings.WORKSPACE_VOLUME}, ${localSettings.AGENT_VOLUME}, ${localSettings.GIT_VOLUME}, ${localSettings.HERDR_VOLUME}; sidecar resources use project ${project}.`);
      return;
    }
    if (ready) compose(["down", "--volumes", "--remove-orphans", "--timeout", "10"], { timeout: 60_000 });
    rmSync(directory, { recursive: true, force: true });
  }
  function interrupt(code) {
    console.error(`Interrupted test project ${project}.`);
    try {
      cleanup(true);
    } catch (error) {
      console.error(`Cleanup failed in ${directory}: ${redact(error.message)}`);
    }
    process.exit(code);
  }
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    // Never copy the checkout's .env, data, or container build inputs.
    for (const path of ["Makefile", "scripts", ...readdirSync(root).filter(
      (file) => /^compose(?:\.[\w-]+)?\.yaml$/.test(file),
    )]) cpSync(join(root, path), join(directory, path), { recursive: true });
    writeFileSync(join(directory, ".env"), Object.entries(localSettings)
      .map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600 });
    ready = true;
    result = await run(p);
  } catch (error) {
    failure = new Error(redact(error instanceof Error ? error.stack || error.message : error));
    if (ready) {
      // Status only: config, environment and application logs may contain secrets.
      try {
        console.error(redact(compose(["ps", "--all"], { timeout: 15_000 })));
      } catch { /* Diagnostics must not mask the original failure. */ }
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    try {
      cleanup(Boolean(failure));
    } catch (error) {
      console.error(`Cleanup failed for project ${project} in ${directory}: ${redact(error.message)}`);
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return result;
}
