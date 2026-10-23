// Read-only data-loss guards before Compose starts or replaces Pi Box.
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
  const service = config.services["pi-box"];
  const paths = [
    "/workspace",
    "/home/node/.pi/agent",
    "/home/node/.config/git",
    "/home/node/.herdr",
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
      "Expected exactly the four writable named volumes. Extra or bind mounts require manual handling.",
    );
  }
  const volumes = service.volumes.map((mount) => ({
    name: config.volumes[mount.source].name,
    destination: mount.target,
  }));
  if (new Set(volumes.map((volume) => volume.name)).size !== paths.length) {
    throw new Error("Workspace, agent, Git and Herdr volumes must be distinct.");
  }
  return {
    project: config.name,
    container: service.container_name,
    image: service.image,
    volumes,
  };
}

/** Refuse any replacement unless persistent mounts and disposable files are safe. */
export function checkContainer() {
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
    "label=com.docker.compose.service=pi-box",
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
  if (names.includes(container)) {
    const [existing] = JSON.parse(docker(["container", "inspect", container]));
    const labels = existing.Config.Labels || {};
    // Compose can stamp project/service labels onto images too. Only a
    // container-specific config hash identifies a Compose-managed container.
    if (
      !labels["com.docker.compose.config-hash"] ||
      labels["com.docker.compose.project"] !== project ||
      labels["com.docker.compose.service"] !== "pi-box"
    ) {
      throw new Error(
        `${container} is not managed by this Compose project/service. Handle it manually; refusing replacement.`,
      );
    }
    // A pre-Herdr container may gain the new volume, but never change old mounts.
    const addingHerdr = !existing.Mounts.some(
      (mount) => mount.Destination === "/home/node/.herdr",
    );
    const previousVolumes = addingHerdr
      ? volumes.filter((volume) => volume.destination !== "/home/node/.herdr")
      : volumes;
    if (
      existing.Mounts.length !== previousVolumes.length ||
      !previousVolumes.every((expected) =>
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
        `Unexpected mounts on ${container}. Existing writable named volumes must match; handle different mounts manually.`,
      );
    }
    if (!existing.State.Running) {
      throw new Error(
        `Start ${container} first so its non-persistent files can be checked.`,
      );
    }
    docker(["exec", "-i", container, "sh", "-s"], {
      // Do not hide unmounted Herdr data behind the new volume on replacement.
      input: (addingHerdr ? `
if [ -e /home/node/.herdr ] || [ -L /home/node/.herdr ]; then
    echo 'Refusing replacement: non-persistent /home/node/.herdr exists. Preserve it manually first.' >&2
    exit 1
fi
` : "") + readFileSync(
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
  console.log(
    "Preflight passed. Files outside the four volumes may be lost on replacement; stop jobs and review work first.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length > 2) {
      throw new Error("Usage: node scripts/check-container.mjs");
    }
    checkContainer();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
