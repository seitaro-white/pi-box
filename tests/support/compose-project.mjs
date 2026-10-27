import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { provideDisposable } from "./acceptance.mjs";
import { runCommand } from "./engine.mjs";
import { root } from "./files.mjs";

/**
 * A `test` with a file-scoped `project` fixture: a private, disposable Compose
 * project built from the public Make/Compose files, never the checkout's .env.
 * Commands capture output (even with inherit requested) so failures can be
 * redacted; they accept the same input/env/cwd/timeout options as runCommand.
 *
 * @param {{name: string, overlays?: string[], settings?: object}} options
 */
export function composeTest({ name, overlays = [], settings = {} }) {
  return test.extend({
    project: [
      // biome-ignore lint/correctness/noEmptyPattern: Vitest reads fixture dependencies from this destructuring pattern.
      async ({}, use) => {
        await provideDisposable(composeProject(name, overlays, settings), use);
      },
      { scope: "file" },
    ],
  });
}

/** Disposable resources for provideDisposable; setup() returns the fixture value. */
function composeProject(name, overlays, settings) {
  const project = `pi-box-${name}-${randomUUID()}`;
  const directory = join(tmpdir(), project);
  const localSettings = {
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    BROWSER_TOKEN: randomBytes(32).toString("hex"),
    PHOENIX_UI_PORT: "0",
    DEV_PORT: "0", // Ephemeral host port: never collide with an operator's dev server.
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
  let ready = false;

  return {
    names: `project ${project} in ${directory}; volumes ${localSettings.WORKSPACE_VOLUME}, ${localSettings.AGENT_VOLUME}, ${localSettings.GIT_VOLUME}, ${localSettings.HERDR_VOLUME}`,
    redact,
    setup() {
      mkdirSync(directory, { mode: 0o700 });
      // Never copy the checkout's .env, data, or container build inputs.
      for (const path of ["Makefile", "scripts", ...readdirSync(root).filter(
        (file) => /^compose(?:\.[\w-]+)?\.yaml$/.test(file),
      )]) cpSync(join(root, path), join(directory, path), { recursive: true });
      writeFileSync(join(directory, ".env"), Object.entries(localSettings)
        .map(([key, value]) => `${key}=${value}\n`).join(""), { mode: 0o600 });
      ready = true;
      return {
        root, directory, project, settings: localSettings, docker, compose,
        make: (target) => command("make", ["-o", "build", target]),
        config: (files = []) => JSON.parse(compose([
          ...files.flatMap((file) => ["-f", file]), "config", "--format", "json",
        ])),
        inspect: (id) => JSON.parse(docker(["inspect", id]))[0],
      };
    },
    cleanup(failed) {
      if (ready && failed) {
        // Status only: config, environment and application logs may contain secrets.
        try {
          console.error(redact(compose(["ps", "--all"], { timeout: 15_000 })));
        } catch { /* Diagnostics must not mask the original failure. */ }
      }
      try {
        if (ready) compose(["down", "--volumes", "--remove-orphans", "--timeout", "10"], { timeout: 60_000 });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
