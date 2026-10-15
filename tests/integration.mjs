// @ts-check
import { fileURLToPath, pathToFileURL } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

/**
 * Run host tests, then both smoke suites against prebuilt images, stopping on failure.
 * No image build, dependency installation or operator-container replacement occurs here.
 *
 * @param {NodeJS.ProcessEnv} [env] Image overrides and engine selection.
 * @param {typeof runCommand} [run] Injectable process runner for host-only tests.
 * @returns {void}
 */
export function runIntegration(env = process.env, run = runCommand) {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  const options = { cwd, env, inherit: true, timeout: 10 * 60_000 };
  run("npm", ["test"], options);
  for (const [profile, image] of [
    ["recommended", env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0"],
    ["base", env.PI_BOX_BASE_IMAGE || "pi-box:0.2.0-base"],
  ]) {
    run(process.execPath, ["tests/smoke.mjs"], {
      ...options,
      env: { ...env, PI_BOX_PROFILE: profile, PI_BOX_IMAGE: image },
    });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    runIntegration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
