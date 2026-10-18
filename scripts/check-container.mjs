// Compose owns the lifecycle. This preflight adds only our data-loss guards and
// an explicit one-time handover for containers originally started with docker run.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function docker(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        `docker ${args[0]} failed (${result.signal || result.status})`,
    );
  }
  return result.stdout?.trim() || "";
}

/** Read the same resolved configuration that Compose will actually use. */
function configuration() {
  const config = JSON.parse(docker(["compose", "config", "--format", "json"]));
  const service = config.services.pi;
  const paths = [
    "/workspace",
    "/home/node/.pi/agent",
    "/home/node/.config/git",
  ];
  if (
    !service?.container_name ||
    !service.image ||
    service.volumes?.length !== paths.length ||
    !paths.every((path) =>
      service.volumes.some(
        (mount) =>
          mount.type === "volume" &&
          mount.target === path &&
          !mount.read_only &&
          config.volumes?.[mount.source]?.name,
      ),
    )
  ) {
    throw new Error(
      "Expected exactly the three writable named volumes. Extra or bind mounts require manual handling.",
    );
  }
  const volumes = service.volumes.map((mount) => ({
    name: config.volumes[mount.source].name,
    destination: mount.target,
  }));
  if (new Set(volumes.map((volume) => volume.name)).size !== paths.length) {
    throw new Error("Workspace, agent and Git volumes must be distinct.");
  }
  return {
    project: config.name,
    container: service.container_name,
    image: service.image,
    volumes,
  };
}

/** Refuse any replacement unless persistent mounts and disposable files are safe. */
export function checkContainer(mode = "check") {
  if (!["check", "migrate"].includes(mode)) {
    throw new Error("Usage: node scripts/check-container.mjs {check|migrate}");
  }
  const { project, container, image, volumes } = configuration();
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

  // A changed CONTAINER must not bypass checks on the project's old service.
  const owned = docker([
    "container",
    "ls",
    "--all",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    "label=com.docker.compose.service=pi",
    "--filter",
    "label=com.docker.compose.config-hash",
    "--format",
    "{{.Names}}",
  ])
    .split("\n")
    .filter(Boolean);
  if (owned.some((name) => name !== container)) {
    throw new Error(
      "This Compose project already has a differently named Pi container. Handle it manually before changing CONTAINER.",
    );
  }
  const names = docker([
    "container",
    "ls",
    "--all",
    "--format",
    "{{.Names}}",
  ]).split("\n");
  let existing;
  let legacy = false;
  if (names.includes(container)) {
    [existing] = JSON.parse(docker(["container", "inspect", container]));
    const labels = existing.Config.Labels || {};
    // Compose can stamp project/service labels onto images too. Only a
    // container-specific config hash identifies a Compose-managed container.
    legacy = !labels["com.docker.compose.config-hash"];
    if (
      !legacy &&
      (labels["com.docker.compose.project"] !== project ||
        labels["com.docker.compose.service"] !== "pi")
    ) {
      throw new Error(
        `${container} belongs to another Compose project or service; refusing to touch it.`,
      );
    }
    if (
      existing.Mounts.length !== volumes.length ||
      !volumes.every((expected) =>
        existing.Mounts.some(
          (actual) =>
            actual.Type === "volume" &&
            actual.RW &&
            actual.Name === expected.name &&
            actual.Destination === expected.destination,
        ),
      )
    ) {
      throw new Error(
        `Unexpected mounts on ${container}. All three writable named volumes are required; handle different mounts manually.`,
      );
    }
    if (!existing.State.Running) {
      throw new Error(
        `Start ${container} first so its non-persistent files can be checked.`,
      );
    }
    docker(["exec", "-i", container, "sh", "-s"], {
      input: readFileSync(
        new URL("./check-disposable-files.sh", import.meta.url),
        "utf8",
      ),
    });
  }
  for (const volume of volumes) {
    const users = docker([
      "ps",
      "--filter",
      `volume=${volume.name}`,
      "--format",
      "{{.Names}}",
    ]).split("\n");
    const other = users.find((name) => name && name !== container);
    if (other) throw new Error(`Volume ${volume.name} is in use by ${other}.`);
  }
  if (legacy && mode !== "migrate") {
    throw new Error(
      `Existing ${container} was not created by Compose. Run make migrate for a checked, one-time handover. This ends running sessions.`,
    );
  }
  if (legacy) {
    // All checks finish before mutation. Use the inspected ID, not a reusable name.
    docker(["stop", existing.Id], { stdio: "inherit" });
    docker(["rm", existing.Id], { stdio: "inherit" });
  }
  console.log(
    "Preflight passed. Files outside the three volumes may be lost on replacement; stop jobs and review work first.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    checkContainer(process.argv[2]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
