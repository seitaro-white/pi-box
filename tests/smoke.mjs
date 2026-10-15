// @ts-check
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createEngine, runCommand } from "./helpers/engine.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * @typedef {object} SmokeOptions
 * @property {NodeJS.ProcessEnv} [env] Profile, image and engine configuration.
 * @property {import("./helpers/engine.mjs").Engine} [engine] Injectable runner for host-only tests.
 * @property {(ms: number) => Promise<void>} [sleep] Injectable readiness delay.
 * @property {(address: string) => void} [checkHttp] Host-side HTTP assertion.
 */

/**
 * Smoke-test one prebuilt image using only uniquely named, disposable resources.
 * Successful runs clean up; failures and interruptions retain resources for inspection.
 * All assertions use synthetic state, without model calls or operator credentials.
 *
 * @param {SmokeOptions} [options] Configuration and host-test seams.
 * @returns {Promise<void>} Resolves only after every assertion and cleanup succeeds.
 */
export async function runSmoke(options = {}) {
  const env = options.env ?? process.env;
  const profile = env.PI_BOX_PROFILE || "recommended";
  if (profile !== "base" && profile !== "recommended") {
    throw new Error("PI_BOX_PROFILE must be base or recommended");
  }
  const image =
    env.PI_BOX_IMAGE || `pi-box:0.2.0${profile === "base" ? "-base" : ""}`;
  const engine = options.engine ?? createEngine(env);
  const sleep = options.sleep ?? delay;
  const name = `pi-box-smoke-${randomUUID()}`;
  const web = `${name}-web`;
  const volumes = [
    { name: `${name}-workspace`, path: "/workspace" },
    { name: `${name}-agent`, path: "/home/node/.pi/agent" },
    { name: `${name}-git`, path: "/home/node/.config/git" },
  ];
  const label = `io.pi-box.smoke=${name}`;
  const security = ["--cap-drop=ALL", "--security-opt=no-new-privileges"];
  const { dependencies } =
    /** @type {{dependencies: Record<string, string>}} */ (
      JSON.parse(
        readFileSync(
          new URL("../container/package.json", import.meta.url),
          "utf8",
        ),
      )
    );

  /** Report only this run's resource names; never attempt cleanup after a failure. */
  function reportRetained() {
    console.error(
      `FAILED: inspect retained resources ${[name, web, ...volumes.map((v) => v.name)].join(", ")}`,
    );
  }

  /** Poll for the shell session, retaining container logs if readiness times out. */
  async function waitForStartup() {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        engine.succeeds(["exec", name, "tmux", "has-session", "-t", "=shell"])
      )
        return;
      await sleep(1000);
    }
    engine.run(["logs", name], { inherit: true });
    throw new Error("Container startup did not complete");
  }

  /** Launch with private test volumes, reduced privileges and no network. */
  async function launch() {
    engine.run([
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
    engine.run(
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

  // The CLI's signal handlers trigger this exit hook on interruptions too.
  process.once("exit", reportRetained);
  try {
    console.log(`\n=== ${profile} image: ${image} ===`);
    engine.run(["info"]);
    if (
      engine.kind === "podman" &&
      engine.run(["info", "--format", "{{.Host.Security.Rootless}}"]) !== "true"
    )
      throw new Error("Podman smoke tests require rootless mode");
    engine.run(["image", "inspect", image]);
    for (const volume of volumes) {
      const existing = engine.run(["volume", "ls", "--format", "{{.Name}}"]);
      if (existing.split("\n").includes(volume.name)) {
        throw new Error(`Refusing to reuse ${volume.name}`);
      }
      engine.run(["volume", "create", "--label", label, volume.name]);
    }

    await launch();
    fixture("check-identity.sh", [
      `EXPECTED_PI_VERSION=${dependencies["@earendil-works/pi-coding-agent"]}`,
      `EXPECTED_PROFILE=${profile}`,
    ]);
    fixture("check-extensions.mjs", [
      "PI_OFFLINE=1",
      `EXPECTED_DEPENDENCIES_JSON=${JSON.stringify(dependencies)}`,
    ]);
    fixture("seed-storage.mjs");

    for (const transition of ["restart", "replacement"]) {
      if (transition === "restart") {
        engine.run(["stop", "--time", "10", name]);
        engine.run(["start", name]);
        await waitForStartup();
      } else {
        engine.run(["rm", "--force", name]);
        await launch();
      }
      fixture("check-persistence.mjs", [`STORAGE_TRANSITION=${transition}`]);
    }

    if (profile === "recommended") {
      // Only this separate, credential-free HTTP container gets networking.
      engine.run([
        "run",
        "-d",
        "--name",
        web,
        "--label",
        label,
        ...security,
        "--publish",
        "127.0.0.1::19432",
        "-e",
        "PLANNOTATOR_DATA_DIR=/tmp/plannotator-test",
        image,
      ]);
      engine.run([
        "cp",
        fileURLToPath(
          new URL("./fixtures/serve-plannotator.mjs", import.meta.url),
        ),
        `${web}:/tmp/serve-plannotator.mjs`,
      ]);
      engine.run(["exec", "-d", web, "node", "/tmp/serve-plannotator.mjs"]);
      const address = engine.run(["port", web, "19432/tcp"]);
      if (!/^127\.0\.0\.1:\d+$/.test(address)) {
        throw new Error(
          `Expected one host-loopback port mapping, got ${address}`,
        );
      }
      const checkHttp =
        options.checkHttp ??
        ((target) => {
          runCommand(
            process.execPath,
            ["tests/fixtures/check-plannotator-http.mjs", target],
            {
              cwd: root,
              env,
              inherit: true,
            },
          );
        });
      checkHttp(address);
      engine.run(["rm", "--force", web]);
    }

    engine.run(["rm", "--force", name]);
    engine.run(["volume", "rm", ...volumes.map((volume) => volume.name)]);
    console.log(
      `PASS: ${profile} image: startup, pins, extension registration, permissions and restart/replacement persistence. No model calls.`,
    );
  } catch (error) {
    reportRetained();
    throw error;
  } finally {
    process.removeListener("exit", reportRetained);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Exit without cleaning test resources; the exit hook prints their names.
  process.once("SIGINT", () => process.exit(130));
  process.once("SIGTERM", () => process.exit(143));
  runSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
