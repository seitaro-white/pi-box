// Smoke-test one prebuilt image using only uniquely named, disposable resources.
// All assertions use synthetic state, without model calls or operator credentials.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { acceptanceSuite, waitFor } from "./helpers/acceptance.mjs";
import { runCommand } from "./helpers/engine.mjs";

const env = process.env;
const profile = env.PI_BOX_PROFILE || "recommended";
if (profile !== "base" && profile !== "recommended") {
  throw new Error("PI_BOX_PROFILE must be base or recommended");
}
const image =
  env.PI_BOX_IMAGE || `pi-box:0.2.0${profile === "base" ? "-base" : ""}`;
const docker = (args, options = {}) => runCommand("docker", args, options);
const name = `pi-box-smoke-${randomUUID()}`;
const volumes = [
  { name: `${name}-workspace`, path: "/workspace" },
  { name: `${name}-agent`, path: "/home/node/.pi/agent" },
  { name: `${name}-git`, path: "/home/node/.config/git" },
  { name: `${name}-herdr`, path: "/home/node/.herdr" },
];
const label = `io.pi-box.smoke=${name}`;
const security = ["--cap-drop=ALL", "--security-opt=no-new-privileges"];
const manifest =
  /** @type {{dependencies: Record<string, string>, piBox: {npmTools: string[]}}} */ (
    JSON.parse(
      readFileSync(new URL("../container/package.json", import.meta.url), "utf8"),
    )
  );
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
/** Read a pinned build argument's default. @param {string} arg ARG name. */
const dockerArg = (arg) => dockerfile.match(new RegExp(`^ARG ${arg}=(.+)$`, "m"))[1];

/** @type {string[]} */
const createdVolumes = [];
let launchAttempted = false;

/**
 * Send a checked-in assertion to the container through stdin.
 * @param {string} filename Fixture basename.
 * @param {string[]} [variables] Synthetic KEY=value environment arguments.
 */
function fixture(filename, variables = []) {
  const interpreter = filename.endsWith(".sh")
    ? ["sh", "-s"]
    : ["node", "--input-type=module"];
  docker(
    ["exec", "-i", ...variables.flatMap((value) => ["-e", value]), name, ...interpreter],
    {
      input: readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), "utf8"),
      inherit: true,
    },
  );
}

acceptanceSuite(`${profile} image: ${image}`, {
  names: `container ${name}, volumes ${volumes.map((volume) => volume.name).join(", ")}`,
  /** Launch with private test volumes, reduced privileges and no network. */
  async setup() {
    docker(["image", "inspect", image]);
    for (const volume of volumes) {
      docker(["volume", "create", "--label", label, volume.name]);
      createdVolumes.push(volume.name);
    }
    launchAttempted = true;
    docker([
      "run", "-d", "--name", name, "--label", label, ...security, "--network=none",
      ...volumes.flatMap((volume) => ["-v", `${volume.name}:${volume.path}`]),
      image,
    ]);
    try {
      await waitFor(() => docker([
        "exec", name, "sh", "-c",
        "tmux has-session -t '=shell' 2>/dev/null && printf ready || true",
      ]) === "ready", { message: "Container startup did not complete" });
    } catch (error) {
      docker(["logs", name], { inherit: true });
      throw error;
    }
  },
  /** Remove only this run's resources. */
  cleanup() {
    const errors = [];
    if (launchAttempted) {
      try {
        // A failed docker run can still create a container; match our unique label.
        const ids = docker([
          "container", "ls", "--all", "--filter", `label=${label}`, "--format", "{{.ID}}",
        ]);
        if (ids) docker(["rm", "--force", ...ids.split("\n")]);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const volume of createdVolumes) {
      try {
        docker(["volume", "rm", volume]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        `Cleanup failed for ${name}: ${errors.map(String).join("; ")}`,
      );
    }
  },
}, (step) => {
  step("identity, pinned tools and private state directories", () => {
    fixture("check-identity.sh", [
      `EXPECTED_PI_VERSION=${manifest.dependencies["@earendil-works/pi-coding-agent"]}`,
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_HUNK_VERSION=${dockerArg("HUNK_VERSION")}`,
      `EXPECTED_HERDR_VERSION=${dockerArg("HERDR_VERSION")}`,
    ]);
  });

  step("extensions, guidance and diagnostics load offline", () => {
    fixture("check-extensions.mjs", [
      "PI_OFFLINE=1",
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_MANIFEST_JSON=${JSON.stringify(manifest)}`,
    ]);
  });

  step("npm installs work offline from the cache", () => {
    fixture("check-npm-cache.sh");
  });
});
