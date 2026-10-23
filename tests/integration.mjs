// Acceptance against prebuilt images. Host checks remain a separate `npm test`.
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const suites = {
  config: ["compose-configuration.mjs"],
  base: ["smoke.mjs", {
    PI_BOX_PROFILE: "base",
    PI_BOX_IMAGE: process.env.PI_BOX_BASE_IMAGE || "pi-box:0.2.0-base",
  }],
  recommended: ["smoke.mjs", {
    PI_BOX_PROFILE: "recommended",
    PI_BOX_IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
  }],
  herdr: ["herdr-integration.mjs"],
  sandbox: ["sandbox-image.mjs"],
  compose: ["compose.mjs"],
  postgres: ["postgres-integration.mjs"],
  browserless: ["browserless-integration.mjs"],
  phoenix: ["phoenix-integration.mjs"],
};
const requested = process.argv.slice(2);
const selected = requested.length === 0
  ? Object.keys(suites).filter((name) => name !== "phoenix")
  : requested.length === 1 && requested[0] === "--all"
    ? Object.keys(suites)
    : requested;

try {
  for (const name of selected) {
    if (!Object.hasOwn(suites, name)) {
      throw new Error(`Unknown suite ${name}; choose ${Object.keys(suites).join(", ")} or --all`);
    }
  }
  for (const name of selected) {
    const [file, overrides = {}] = suites[name];
    console.log(`\n=== ${name} acceptance ===`);
    runCommand(process.execPath, [`tests/${file}`], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, ...overrides },
      inherit: true,
      timeout: 10 * 60_000,
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
