import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand } from "./helpers/engine.mjs";

/**
 * Smoke-test one prebuilt image using only uniquely named, disposable resources.
 * Clean up owned resources unless a failed run explicitly requests retention.
 * All assertions use synthetic state, without model calls or operator credentials.
 *
 * @returns {Promise<void>} Resolves only after every assertion and cleanup succeeds.
 */
async function runSmoke() {
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
        readFileSync(
          new URL("../container/package.json", import.meta.url),
          "utf8",
        ),
      )
    );

  /** @type {string[]} */
  const createdVolumes = [];
  let launchAttempted = false;

  /** Remove only this run's resources. @param {boolean} failed Retain only failed runs when requested. */
  function cleanup(failed) {
    if (failed && env.PI_BOX_KEEP_TEST_RESOURCES === "1") {
      console.error(
        `FAILED: retained container ${name}, volumes ${createdVolumes.join(", ")}`,
      );
      return;
    }
    const errors = [];
    if (launchAttempted) {
      try {
        // A failed docker run can still create a container; match our unique label.
        const ids = docker([
          "container", "ls", "--all", "--filter", `label=${label}`,
          "--format", "{{.ID}}",
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
  }

  /** Interruptions follow the failed-run policy. @param {number} code Signal exit status. */
  function interrupt(code) {
    try {
      cleanup(true);
    } catch (error) {
      console.error(String(error));
    }
    process.exit(code);
  }
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);

  /** Poll for the shell session, retaining container logs if readiness times out. */
  async function waitForStartup() {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        docker([
          "exec", name, "sh", "-c",
          "tmux has-session -t '=shell' 2>/dev/null && printf ready || true",
        ]) === "ready"
      )
        return;
      await delay(1000);
    }
    docker(["logs", name], { inherit: true });
    throw new Error("Container startup did not complete");
  }

  /** Launch with private test volumes, reduced privileges and no network. */
  async function launch() {
    launchAttempted = true;
    docker([
      "run",
      "-d",
      "--name",
      name,
      "--label",
      label,
      ...security,
      "--network=none",
      ...volumes.flatMap((volume) => ["-v", `${volume.name}:${volume.path}`]),
      image,
    ]);
    await waitForStartup();
  }

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
      [
        "exec",
        "-i",
        ...variables.flatMap((value) => ["-e", value]),
        name,
        ...interpreter,
      ],
      {
        input: readFileSync(
          new URL(`./fixtures/${filename}`, import.meta.url),
          "utf8",
        ),
        inherit: true,
      },
    );
  }

  let succeeded = false;
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    console.log(`\n=== ${profile} image: ${image} ===`);
    docker(["image", "inspect", image]);
    for (const volume of volumes) {
      docker(["volume", "create", "--label", label, volume.name]);
      createdVolumes.push(volume.name);
    }

    await launch();
    fixture("check-identity.sh", [
      `EXPECTED_PI_VERSION=${manifest.dependencies["@earendil-works/pi-coding-agent"]}`,
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_HUNK_VERSION=${readFileSync(new URL("../Dockerfile", import.meta.url), "utf8").match(/^ARG HUNK_VERSION=(.+)$/m)[1]}`,
    ]);
    fixture("check-extensions.mjs", [
      "PI_OFFLINE=1",
      `EXPECTED_PROFILE=${profile}`,
      `EXPECTED_MANIFEST_JSON=${JSON.stringify(manifest)}`,
    ]);
    fixture("check-npm-cache.sh");
    succeeded = true;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    cleanup(!succeeded);
  }
  console.log(
    `PASS: ${profile} image: startup, pins, extension loading, diagnostics, permissions and offline npm install. No model calls.`,
  );
}

runSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
