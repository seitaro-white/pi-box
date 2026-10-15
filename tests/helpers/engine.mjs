// @ts-check
import { spawnSync } from "node:child_process";

/**
 * @typedef {object} CommandOptions
 * @property {string} [input] Fixture contents sent to stdin, without a host shell.
 * @property {boolean} [inherit] Stream stdout/stderr instead of capturing them.
 * @property {number} [timeout] Maximum command duration in milliseconds.
 * @property {NodeJS.ProcessEnv} [env] Environment for the child process.
 * @property {string} [cwd] Working directory for the child process.
 */

/**
 * @typedef {object} Engine
 * @property {"docker" | "podman"} kind Selected container engine.
 * @property {(args: string[], options?: CommandOptions) => string} run Run or throw.
 * @property {(args: string[]) => boolean} succeeds Quiet readiness probe; spawn errors still throw.
 */

/**
 * Execute an argument array directly. Keep commands bounded and preserve failures.
 *
 * @param {string} executable Program name or absolute path.
 * @param {string[]} args Arguments, never interpreted by a shell.
 * @param {CommandOptions} [options] Input, output and process configuration.
 * @returns {import("node:child_process").SpawnSyncReturns<string>} Process result.
 */
function execute(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: options.inherit ? ["pipe", "inherit", "inherit"] : "pipe",
    input: options.input,
    env: options.env,
    cwd: options.cwd,
  });
  if (result.error) throw result.error;
  return result;
}

/**
 * Run a command and surface its exit status and diagnostic output on failure.
 *
 * @param {string} executable Program name or absolute path.
 * @param {string[]} args Arguments passed without a shell.
 * @param {CommandOptions} [options] Process configuration.
 * @returns {string} Trimmed captured stdout, or empty when streaming output.
 */
export function runCommand(executable, args, options = {}) {
  const result = execute(executable, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${executable} ${args[0] ?? ""} failed (${result.signal ?? result.status})` +
        (result.stderr?.trim() ? `: ${result.stderr.trim()}` : ""),
    );
  }
  return result.stdout?.trim() ?? "";
}

/**
 * Select Docker by default, or explicitly configured rootless Podman.
 *
 * @param {NodeJS.ProcessEnv} [env] Engine selection and executable overrides.
 * @returns {Engine} Shell-free command runner and readiness probe.
 */
export function createEngine(env = process.env) {
  const kind = env.PI_BOX_ENGINE || "docker";
  if (kind !== "docker" && kind !== "podman") {
    throw new Error("PI_BOX_ENGINE must be docker or podman");
  }
  const executable =
    kind === "docker"
      ? env.DOCKER_BIN || "docker"
      : env.PODMAN_BIN || "/opt/podman/bin/podman";
  const prefix =
    kind === "podman"
      ? ["--connection", env.PODMAN_CONNECTION || "podman-machine-default"]
      : [];
  return {
    kind,
    run: (args, options) =>
      runCommand(executable, [...prefix, ...args], { env, ...options }),
    succeeds: (args) =>
      execute(executable, [...prefix, ...args], { env }).status === 0,
  };
}
