# Tests

Tests cover Pi Box's configuration, state-management and integration boundaries—not the complete feature sets of Docker, Pi extensions or sidecars. Host tests use only Node.js built-ins. Docker acceptance uses synthetic state and isolated projects; it never attaches to the normal Pi Box container or volumes.

## Commands

```sh
npm test                         # Fast checks; no Docker or npm install

# Build the three images consumed by the default acceptance suite.
docker build --target base -t pi-box:0.2.0-base .
docker build --target recommended -t pi-box:0.2.0 .
docker build -f sandbox/pi-box.dockerfile -t pi-box:0.2.0-sandbox .
npm run test:integration

# Run selected checks, or explicitly include Phoenix.
npm run test:integration -- config
npm run test:integration -- compose postgres
npm run test:integration -- phoenix
npm run test:integration -- --all
```

The default selection is `config base recommended sandbox compose postgres browserless`. Host tests run separately; acceptance does not repeat them. CI builds all three images and uses this same default selection on native AMD64/ARM64 runners.

Override prebuilt image names with `PI_BOX_BASE_IMAGE`, `PI_BOX_RECOMMENDED_IMAGE` and `PI_BOX_SANDBOX_IMAGE`. Individual `smoke.mjs` runs also accept `PI_BOX_PROFILE` and `PI_BOX_IMAGE`. Sidecar acceptance may pull the pinned upstream images; Browserless installs its lockfile-pinned client in disposable Pi storage, and Phoenix explicitly installs the documented `pi-otel` package there.

## Layout and responsibilities

- `*.test.mjs`: state initialization/reconciliation, preflight data-loss guards, manifest/lockfile drift, version reporting and sandbox build-context boundaries.
- `integration.mjs`: selects acceptance suites; no image building.
- `compose-configuration.mjs`: resolves all eight overlay selections and checks wiring, optionality, storage names and network exposure. Does not start containers.
- `smoke.mjs`: image identity, writable/private state, pinned runtime, extension loading and basic LSP connectivity for base/recommended images.
- `compose.mjs`: real Make/Compose startup, idempotence, replacement refusal and persistence of workspace, Pi state and Git credentials. This is the authoritative lifecycle test.
- `postgres-integration.mjs`: a Pi-side SQL connection and a stored value surviving database recreation.
- `browserless-integration.mjs`: authenticated CDP and navigation from the browser to a Pi-served page.
- `phoenix-integration.mjs`: documented exporter setup, a recognizable synthetic Pi trace and persistent Phoenix storage. Opt-in; no real models or credentials.
- `sandbox-image.mjs`: sandbox Dockerfile acceptance without sbx/KVM/login.
- `sandbox-smoke.mjs`: **manual diagnostic of an existing sandbox**, not a disposable test. It writes a temporary canary and runs the initializer; optional restart ends active sessions. See [the sandbox guide](../docs/sandboxes.md).
- `helpers/`: command execution, isolated Compose projects, temporary files and synthetic agent state.
- `fixtures/`: executable in-container assertions and small synthetic inputs. `seed-storage.mjs` explicitly creates everything checked by `check-persistence.mjs`.

## Isolation and failures

Compose tests copy public configuration/scripts into a private temporary directory, generate synthetic credentials and override all project/container/volume names. They do not read the checkout's `.env`. Successful runs clean up their own resources. Failures print diagnostics and also clean up by default; set `PI_BOX_KEEP_TEST_RESOURCES=1` to retain a failing test's resources for inspection. Never use global Docker pruning to clean up a test.

Live sandbox checks remain manual. Podman and migration of old `pi`/`db` services or agent volumes predating package-ownership tracking are no longer supported by this suite.
