// Shared structure for Docker acceptance: ordered steps over disposable resources.
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Define a suite whose steps run in order against resources shared by all steps.
 * After the first failure, later steps are skipped rather than failing in cascade.
 * Cleanup runs once, including on SIGINT/SIGTERM; a failed run keeps its resources
 * when PI_BOX_KEEP_TEST_RESOURCES=1.
 *
 * @param {string} title Suite name shown by the test reporter.
 * @param {object} resources Disposable resources owned by the suite.
 * @param {string} resources.names Resource names, reported when retained.
 * @param {() => unknown} resources.setup Create resources before the first step.
 * @param {(failed: boolean) => void} resources.cleanup Remove the resources.
 * @param {(text: string) => string} [resources.redact] Hide secrets in failures.
 * @param {(step: (name: string, run: () => unknown) => void) => void} defineSteps
 */
export function acceptanceSuite(title, resources, defineSteps) {
  const redact = resources.redact ?? String;
  let failed = false;
  const cleanup = () => {
    if (failed && process.env.PI_BOX_KEEP_TEST_RESOURCES === "1") {
      console.error(`Retained resources for failed suite "${title}": ${resources.names}`);
      return;
    }
    resources.cleanup(failed);
  };
  const interrupt = (code) => {
    failed = true;
    try {
      cleanup();
    } catch (error) {
      console.error(redact(`Cleanup failed: ${error.message}`));
    }
    process.exit(code);
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  /** Run a hook or step, recording failure and hiding secrets in its error. */
  const guarded = async (run) => {
    try {
      await run();
    } catch (error) {
      failed = true;
      if (!(error instanceof Error)) throw new Error(redact(error));
      error.message = redact(error.message);
      error.stack = redact(error.stack);
      throw error;
    }
  };

  describe(title, () => {
    before(() => {
      process.once("SIGINT", onInterrupt);
      process.once("SIGTERM", onTerminate);
      return guarded(resources.setup);
    });
    after(() => {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
      cleanup();
    });
    defineSteps((name, run) =>
      it(name, (t) => (failed ? t.skip("an earlier step failed") : guarded(run))),
    );
  });
}

/**
 * Retry a readiness check until it returns a truthy value. Errors count as
 * "not ready yet"; the last one is attached as the timeout's cause.
 *
 * @template T
 * @param {() => T | Promise<T>} check Returns a truthy value when ready.
 * @param {{attempts?: number, intervalMs?: number, message?: string}} [options]
 * @returns {Promise<T>} The first truthy value returned by `check`.
 */
export async function waitFor(check, { attempts = 30, intervalMs = 1000, message = "Timed out waiting" } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(message, { cause: lastError });
}
