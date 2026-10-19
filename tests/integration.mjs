// @ts-check
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

/**
 * Run host/image/Compose/PostgreSQL acceptance against prebuilt Pi images.
 * The optional, digest-pinned PostgreSQL server image is pulled if needed.
 * No image build, dependency installation or operator-container replacement occurs here.
 *
 * @returns {void}
 */
function runIntegration() {
	const env = process.env;
	const cwd = fileURLToPath(new URL("../", import.meta.url));
	const options = { cwd, env, inherit: true, timeout: 10 * 60_000 };
	runCommand("npm", ["test"], options);
	for (const [profile, image] of [
		["recommended", env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0"],
		["base", env.PI_BOX_BASE_IMAGE || "pi-box:0.2.0-base"],
	]) {
		runCommand(process.execPath, ["tests/smoke.mjs"], {
			...options,
			env: { ...env, PI_BOX_PROFILE: profile, PI_BOX_IMAGE: image },
		});
	}
	if (!env.PI_BOX_ENGINE || env.PI_BOX_ENGINE === "docker") {
		runCommand(process.execPath, ["tests/compose.mjs"], options);
		runCommand(process.execPath, ["tests/postgres-integration.mjs"], options);
		runCommand(
			process.execPath,
			["tests/browserless-integration.mjs"],
			options,
		);
	}
}

try {
	runIntegration();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
