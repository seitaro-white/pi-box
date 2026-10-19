// Owned, disposable Make/Compose acceptance; failures retain resources for inspection.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./helpers/engine.mjs";

const project = `pi-box-browserless-${randomUUID()}`;
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = mkdtempSync(join(tmpdir(), project));
for (const path of [
	"Makefile",
	"compose.yaml",
	"compose.postgres.yaml",
	"compose.browserless.yaml",
	"scripts",
]) {
	cpSync(join(root, path), join(directory, path), { recursive: true });
}
const settings = {
	COMPOSE_FILE: "compose.yaml:compose.browserless.yaml",
	COMPOSE_PROJECT_NAME: project,
	CONTAINER: project,
	IMAGE: process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0",
	WORKSPACE_VOLUME: `${project}-workspace`,
	AGENT_VOLUME: `${project}-agent`,
	GIT_VOLUME: `${project}-git`,
	BROWSER_TOKEN: randomBytes(32).toString("hex"),
};
writeFileSync(
	join(directory, ".env"),
	Object.entries(settings)
		.map(([k, v]) => `${k}=${v}\n`)
		.join(""),
	{ mode: 0o600 },
);
const env = { ...process.env };
for (const key of [
	...Object.keys(settings),
	"POSTGRES_PASSWORD",
	"COMPOSE_ENV_FILES",
	"COMPOSE_DISABLE_ENV_FILE",
	"COMPOSE_PROFILES",
	"COMPOSE_PATH_SEPARATOR",
])
	delete env[key];
const options = { cwd: directory, env, timeout: 300_000 };
const docker = (args) => runCommand("docker", args, options);
const compose = (args) => docker(["compose", ...args]);
const config = (files) =>
	JSON.parse(
		compose([...files.flatMap((f) => ["-f", f]), "config", "--format", "json"]),
	);
try {
	const plain = config(["compose.yaml"]);
	assert.deepEqual(Object.keys(plain.services), ["pi-box"]);
	assert.equal(plain.services["pi-box"].environment?.BROWSER_TOKEN, undefined);
	assert.equal(plain.services["pi-box"].environment?.BROWSER_CDP_URL, undefined);
	const combined = JSON.parse(
		runCommand(
			"docker",
			[
				"compose",
				"-f",
				"compose.yaml",
				"-f",
				"compose.postgres.yaml",
				"-f",
				"compose.browserless.yaml",
				"config",
				"--format",
				"json",
			],
			{
				...options,
				env: { ...env, POSTGRES_PASSWORD: "disposable-config-only" },
			},
		),
	);
	assert.deepEqual(Object.keys(combined.services["pi-box"].depends_on).sort(), [
		"browser",
		"postgres",
	]);
	assert.equal(combined.services["pi-box"].environment.PGHOST, "postgres");
	assert.equal(
		combined.services["pi-box"].environment.PGPASSWORD,
		"disposable-config-only",
	);
	assert.equal(
		combined.services["pi-box"].environment.BROWSER_TOKEN,
		settings.BROWSER_TOKEN,
	);
	assert.equal(
		combined.services["pi-box"].environment.BROWSER_CDP_URL,
		"ws://browser:3000/chromium",
	);
	const browserConfig = combined.services.browser;
	assert.equal(browserConfig.environment.TOKEN, settings.BROWSER_TOKEN);
	assert.equal(browserConfig.ports, undefined);
	assert.equal(browserConfig.volumes, undefined);
	assert.equal(browserConfig.build, undefined);
	assert.equal(browserConfig.container_name, undefined);
	runCommand("make", ["-o", "build", "up"], options);
	const id = compose(["ps", "--quiet", "browser"]);
	const container = JSON.parse(docker(["inspect", id]))[0];
	assert.equal(container.State.Health.Status, "healthy");
	assert.equal(container.Config.User, "blessuser");
	assert.equal(container.HostConfig.Init, true);
	assert.equal(container.HostConfig.ShmSize, 2 * 1024 ** 3);
	assert.equal(container.HostConfig.Privileged, false);
	assert.deepEqual(container.HostConfig.PortBindings || {}, {});
	assert.deepEqual(container.Mounts, []);
	assert.ok(
		container.HostConfig.SecurityOpt.includes("no-new-privileges:true"),
	);
	assert.ok(!container.HostConfig.CapAdd?.length);
	compose([
		"cp",
		join(root, "tests/fixtures/browserless"),
		"pi-box:/tmp/browserless-client",
	]);
	compose([
		"exec",
		"-T",
		"pi-box",
		"cp",
		"-R",
		"/tmp/browserless-client",
		"/workspace/browserless-client",
	]);
	compose([
		"exec",
		"-T",
		"-w",
		"/workspace/browserless-client",
		"pi-box",
		"npm",
		"ci",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
	]);
	// Inherit output only for this fixture, which never logs authenticated URLs.
	runCommand(
		"docker",
		[
			"compose",
			"exec",
			"-T",
			"-w",
			"/workspace/browserless-client",
			"pi-box",
			"node",
			"check.mjs",
		],
		{ ...options, inherit: true },
	);
	compose(["down"]);
	docker([
		"volume",
		"rm",
		settings.WORKSPACE_VOLUME,
		settings.AGENT_VOLUME,
		settings.GIT_VOLUME,
	]);
	rmSync(directory, { recursive: true, force: true });
	console.log("PASS: optional Browserless Compose configuration and lifecycle");
} catch {
	// Do not echo command errors: third-party clients may include token-bearing URLs.
	console.error(
		`FAILED: retained isolated project ${project} and private directory ${directory}.`,
	);
	process.exitCode = 1;
}
