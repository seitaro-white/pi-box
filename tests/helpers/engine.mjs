// Shared shell-free command execution for disposable Docker acceptance tests.
import { spawnSync } from "node:child_process";

/** Run a bounded command, returning stdout or surfacing its failure. */
export function runCommand(executable, args, options = {}) {
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
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    throw new Error(
      `${executable} ${args[0] ?? ""} failed (${result.signal ?? result.status})` +
        (detail ? `: ${detail}` : ""),
    );
  }
  return result.stdout?.trim() ?? "";
}
