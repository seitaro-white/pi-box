import { defineConfig } from "vitest/config";

// Docker acceptance shares one engine: run files one at a time, in child
// processes so interrupt handlers can clean up, with build-scale timeouts.
const acceptance = {
  pool: "forks",
  fileParallelism: false,
  testTimeout: 10 * 60_000,
  hookTimeout: 10 * 60_000,
  teardownTimeout: 2 * 60_000,
};

export default defineConfig({
  test: {
    projects: [
      // Docker-free checks: `npm test`.
      { test: { name: "unit", include: ["tests/unit/**/*.test.mjs"] } },
      // Prebuilt images and disposable Compose projects: `npm run test:integration`.
      {
        test: {
          name: "acceptance",
          include: ["tests/acceptance/**/*.test.mjs"],
          exclude: ["tests/acceptance/phoenix.test.mjs", "tests/acceptance/sandbox-live.test.mjs"],
          ...acceptance,
        },
      },
      // Opt-in: installs pi-otel from npm and keeps traces.
      { test: { name: "phoenix", include: ["tests/acceptance/phoenix.test.mjs"], ...acceptance } },
      // Opt-in, macOS host only: inspects an existing Docker Sandbox.
      { test: { name: "sandbox-live", include: ["tests/acceptance/sandbox-live.test.mjs"], ...acceptance } },
    ],
  },
});
