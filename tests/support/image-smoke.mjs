// Smoke tests for one prebuilt image, using only uniquely named, disposable
// resources. All checks use synthetic state, without model calls or credentials.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base } from "vitest";
import { incrementalSteps, provideDisposable, waitFor } from "./acceptance.mjs";
import { runCommand } from "./engine.mjs";
import { readJson, root } from "./files.mjs";

const manifest = readJson(join(root, "container/package.json"));
const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
/** Read a pinned build argument's default from the Dockerfile. */
const dockerArg = (arg) => dockerfile.match(new RegExp(`^ARG ${arg}=(.+)$`, "m"))[1];
const docker = (args, options = {}) => runCommand("docker", args, options);

/** Disposable resources for provideDisposable: one offline container with private volumes. */
function smokeContainer(image) {
  const name = `pi-box-smoke-${randomUUID()}`;
  const label = `io.pi-box.smoke=${name}`;
  const volumes = [
    { name: `${name}-workspace`, path: "/workspace" },
    { name: `${name}-agent`, path: "/home/node/.pi/agent" },
    { name: `${name}-git`, path: "/home/node/.config/git" },
    { name: `${name}-herdr`, path: "/home/node/.herdr" },
  ];
  const createdVolumes = [];
  let launchAttempted = false;

  return {
    names: `container ${name}, volumes ${volumes.map((volume) => volume.name).join(", ")}`,
    async setup() {
      docker(["image", "inspect", image]);
      for (const volume of volumes) {
        docker(["volume", "create", "--label", label, volume.name]);
        createdVolumes.push(volume.name);
      }
      launchAttempted = true;
      docker([
        "run", "-d", "--name", name, "--label", label,
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--network=none",
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
      return {
        /** Pipe a checked-in tests/in-container script into the container. */
        runScript(filename, variables = []) {
          const interpreter = filename.endsWith(".sh") ? ["sh", "-s"] : ["node", "--input-type=module"];
          docker(
            ["exec", "-i", ...variables.flatMap((value) => ["-e", value]), name, ...interpreter],
            {
              input: readFileSync(join(root, "tests/in-container", filename), "utf8"),
              inherit: true,
            },
          );
        },
      };
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
        throw new AggregateError(errors, `Cleanup failed for ${name}: ${errors.map(String).join("; ")}`);
      }
    },
  };
}

/**
 * Define the smoke steps for one image profile. The image comes from
 * PI_BOX_BASE_IMAGE or PI_BOX_RECOMMENDED_IMAGE, defaulting to local tags.
 *
 * @param {"base" | "recommended"} profile
 */
export function defineImageSmoke(profile) {
  const image = profile === "base"
    ? process.env.PI_BOX_BASE_IMAGE || "pi-box:0.2.0-base"
    : process.env.PI_BOX_RECOMMENDED_IMAGE || "pi-box:0.2.0";
  const test = base.extend({
    container: [
      // biome-ignore lint/correctness/noEmptyPattern: Vitest reads fixture dependencies from this destructuring pattern.
      async ({}, use) => provideDisposable(smokeContainer(image), use),
      { scope: "file" },
    ],
  });
  incrementalSteps();

  test(`${image}: identity, pinned tools and private state directories`, ({ container }) => {
    container.runScript("check-identity.sh", [
      `EXPECTED_PI_VERSION=${manifest.dependencies["@earendil-works/pi-coding-agent"]}`,
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_HUNK_VERSION=${dockerArg("HUNK_VERSION")}`,
      `EXPECTED_HERDR_VERSION=${dockerArg("HERDR_VERSION")}`,
    ]);
  });

  test("extensions, guidance and diagnostics load offline", ({ container }) => {
    container.runScript("check-extensions.mjs", [
      "PI_OFFLINE=1",
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_MANIFEST_JSON=${JSON.stringify(manifest)}`,
    ]);
  });

  test("npm installs work offline from the cache", ({ container }) => {
    container.runScript("check-npm-cache.sh");
  });
}
