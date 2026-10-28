// Shared structure for Docker acceptance files: ordered steps over disposable
// resources provided by a file-scoped fixture.
import { setTimeout as delay } from "node:timers/promises";
import { beforeEach } from "vitest";

// Module state is per test file: Vitest isolates each file's modules.
let failed = false;
const redactors = [];

/**
 * Run this file's tests as ordered steps over shared resources: once one
 * fails, skip the rest rather than letting them fail in cascade (like pytest's
 * "incremental" recipe). Failure output passes through registered redactors.
 * Call once at the top level of a test file.
 */
export function incrementalSteps() {
  beforeEach(({ skip, onTestFailed }) => {
    if (failed) skip("an earlier step failed");
    onTestFailed(({ task }) => {
      failed = true;
      for (const error of task.result?.errors ?? []) {
        for (const key of ["message", "stack", "diff", "actual", "expected"]) {
          if (typeof error[key] === "string") {
            error[key] = redactors.reduce((text, redact) => redact(text), error[key]);
          }
        }
      }
    });
  });
}

/**
 * Fixture body for disposable resources: set up, provide them to the steps,
 * then clean up. Ctrl-C and SIGTERM also clean up, because Vitest skips
 * fixture teardown when interrupted. If any step failed, resources are kept
 * for inspection when PI_BOX_KEEP_TEST_RESOURCES=1.
 *
 * @template T
 * @param {object} resources
 * @param {string} resources.names Resource names, reported when retained.
 * @param {() => T | Promise<T>} resources.setup Create resources; returns the fixture value.
 * @param {(failed: boolean) => void} resources.cleanup Remove the resources.
 * @param {(text: string) => string} [resources.redact] Hide secrets in failures.
 * @param {(value: T) => Promise<void>} use Vitest's fixture callback.
 */
export async function provideDisposable({ names, setup, cleanup, redact }, use) {
  if (redact) redactors.push(redact);
  const teardown = () => {
    if (failed && process.env.PI_BOX_KEEP_TEST_RESOURCES === "1") {
      console.error(`Retained resources from failed steps: ${names}`);
      return;
    }
    cleanup(failed);
  };
  const interrupt = (code) => {
    failed = true;
    try {
      teardown();
    } catch (error) {
      console.error(`Cleanup failed: ${(redact ?? String)(error.message)}`);
    }
    process.exit(code);
  };
  const onInterrupt = () => interrupt(130);
  const onTerminate = () => interrupt(143);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  try {
    let value;
    try {
      value = await setup();
    } catch (error) {
      failed = true;
      throw error;
    }
    await use(value);
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    teardown();
  }
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
