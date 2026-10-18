import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const image = process.env.IMAGE || "pi-box:0.2.0";
const container = process.env.CONTAINER || "pi-box-dev";
const volumes = [
  {
    name: process.env.WORKSPACE_VOLUME || "pi-box-workspace",
    destination: "/workspace",
  },
  {
    name: process.env.AGENT_VOLUME || "pi-box-agent",
    destination: "/home/node/.pi/agent",
  },
  {
    name: process.env.GIT_VOLUME || "pi-box-git",
    destination: "/home/node/.config/git",
  },
];

/**
 * Run Docker without a host shell and report unsuccessful commands.
 * Inspection output is captured; interactive commands inherit the terminal.
 *
 * @param {string[]} args Docker command and arguments.
 * @param {import("node:child_process").SpawnSyncOptions} [options] Process options.
 * @returns {string} Trimmed stdout, or an empty string when using the terminal.
 * @throws {Error} If Docker cannot run or the command fails.
 */
function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        `docker ${args[0]} failed (${result.signal || result.status})`,
    );
  }
  return result.stdout?.trim() || "";
}

/**
 * Read the configured container's metadata without treating Docker errors as absence.
 *
 * @returns {object | null} Docker inspection data, or null if no container exists.
 */
function inspectContainer() {
  const names = docker([
    "container",
    "ls",
    "--all",
    "--format",
    "{{.Names}}",
  ]).split("\n");
  if (!names.includes(container)) {
    return null;
  }
  return JSON.parse(docker(["container", "inspect", container]))[0];
}

/**
 * Require exactly the three configured named-volume mounts before replacement.
 *
 * @param {{Type: string, Name: string, Destination: string}[]} mounts Docker mounts.
 * @throws {Error} If mounts are missing, unexpected, or bind-mounted.
 */
function checkMounts(mounts) {
  const matches =
    mounts.length === volumes.length &&
    volumes.every((expected) =>
      mounts.some(
        (actual) =>
          actual.Type === "volume" &&
          actual.Name === expected.name &&
          actual.Destination === expected.destination,
      ),
    );
  if (!matches) {
    throw new Error(
      `Unexpected mounts on ${container}. All three named volumes are required. ` +
        "Inspect with docker inspect and set volume overrides to existing names; " +
        "extra or bind mounts require manual replacement.",
    );
  }
}

/** Refuse to discard Git files or SSH keys outside persistent storage. */
function checkDisposableFiles() {
  const script = readFileSync(
    new URL("./check-disposable-files.sh", import.meta.url),
    "utf8",
  );
  // Send this small file to the container's shell, not the host shell.
  docker(["exec", "-i", container, "sh", "-s"], { input: script });
}

/**
 * Perform read-only checks before any container is stopped or removed.
 *
 * @returns {boolean} Whether an existing container needs replacement.
 * @throws {Error} If Docker is unavailable or an existing container is unsafe to replace.
 */
function checkContainer() {
  docker(["info"]);
  const existing = inspectContainer();
  if (!existing) {
    console.log(`No existing ${container}; replacement will create it.`);
    return false;
  }
  checkMounts(existing.Mounts);
  if (!existing.State.Running) {
    throw new Error(
      `Start ${container} first so its non-persistent files can be checked.`,
    );
  }
  checkDisposableFiles();
  console.log(
    "Persistent mounts verified. Other files outside these mounts will be lost.",
  );
  console.log("Review uncommitted work and stop running jobs before replacement.");
  return true;
}

/** Require a Git-volume-aware image before replacing the container. */
function checkImage() {
  const [metadata] = JSON.parse(docker(["image", "inspect", image]));
  if (
    !metadata.Config.Env?.includes(
      "GIT_CONFIG_GLOBAL=/home/node/.config/git/config",
    )
  ) {
    throw new Error(
      "Image does not support the Git volume. Run make build first.",
    );
  }
}

/** Refuse to share writable volumes with another running container. */
function checkVolumesNotShared() {
  for (const volume of volumes) {
    const users = docker([
      "ps",
      "--filter",
      `volume=${volume.name}`,
      "--format",
      "{{.Names}}",
    ]).split("\n");
    const other = users.find((name) => name && name !== container);
    if (other) {
      throw new Error(`Volume ${volume.name} is in use by ${other}.`);
    }
  }
}

/** Poll for the tmux shell session, up to 30 attempts, before declaring readiness. */
async function waitForStartup() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = spawnSync("docker", [
      "exec",
      container,
      "tmux",
      "has-session",
      "-t",
      "=shell",
    ]);
    if (result.error) {
      throw result.error;
    }
    if (result.status === 0) {
      return;
    }
    await delay(1000);
  }
  throw new Error(
    `Container startup did not complete. Inspect docker logs ${container}; ` +
      "persistent volumes have been retained.",
  );
}

/** Replace the container with the built image, ending sessions but retaining volumes. */
async function replaceContainer() {
  // Validate configuration before stopping or removing an existing container.
  checkImage();
  const exists = checkContainer();
  checkVolumesNotShared();
  if (exists) {
    docker(["stop", container], { stdio: "inherit" });
    docker(["rm", container], { stdio: "inherit" });
  }
  docker(
    [
      "run",
      "-d",
      "--name",
      container,
      ...volumes.flatMap((volume) => [
        "-v",
        `${volume.name}:${volume.destination}`,
      ]),
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      image,
    ],
    { stdio: "inherit" },
  );
  await waitForStartup();
}

/** Attach the host terminal to the ready container's existing tmux session. */
async function attachContainer() {
  await waitForStartup();
  docker(
    ["exec", "-it", container, "tmux", "attach-session", "-t", "=shell"],
    { stdio: "inherit" },
  );
}

async function main() {
  switch (process.argv[2]) {
    case "check":
      return checkContainer();
    case "replace":
      return replaceContainer();
    case "attach":
      return attachContainer();
    default:
      throw new Error(
        "Usage: node scripts/dev-container.mjs {check|replace|attach}",
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
