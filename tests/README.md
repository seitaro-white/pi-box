# Tests

## Run

```sh
npm test                         # Node built-ins only; no Docker or npm install

# Build images before acceptance:
docker build --target base -t pi-box:0.2.0-base .
docker build --target recommended -t pi-box:0.2.0 .
docker build --target sandbox -t pi-box:0.2.0-sandbox .
npm run test:integration

# Select suites:
npm run test:integration -- config
npm run test:integration -- compose postgres
npm run test:integration -- phoenix  # opt-in
npm run test:integration -- --all
```

Default suites: `config base recommended herdr sandbox compose postgres browserless`.
CI uses the same selection on native AMD64/ARM64. Override image names with
`PI_BOX_BASE_IMAGE`, `PI_BOX_RECOMMENDED_IMAGE` and `PI_BOX_SANDBOX_IMAGE`.

## Coverage

| Tests | Boundary |
|---|---|
| `*.test.mjs` | State preservation, replacement guards, manifest/lockfile consistency, sandbox definitions |
| `compose-configuration.mjs` | Overlay combinations, storage and port wiring |
| `smoke.mjs` | Base/recommended tools, permissions, Pi guidance/skills, extensions and LSP |
| `herdr-integration.mjs` | Reporter installation, offline extension loading and persistent Herdr state |
| `compose.mjs` | Make/Compose lifecycle, dev port, replacement and persistent Pi/workspace/Git state |
| `postgres-integration.mjs` | SQL connectivity and persistence |
| `browserless-integration.mjs` | Authenticated CDP, Pi-served page interaction and artifacts |
| `phoenix-integration.mjs` | Synthetic Pi traces and Phoenix persistence |
| `sandbox-image.mjs` | Sandbox image without sbx or credentials |

`tests/sandbox-smoke.mjs` is a **manual check of an existing sandbox**; its optional
restart ends running sessions. See the [sandbox guide](../docs/sandboxes.md).

## Writing acceptance suites

Acceptance files use `node:test` through `composeSuite` (Compose projects) or
`acceptanceSuite` (other disposable resources) in `helpers/`. Steps run in order
against shared resources; after a failure the remaining steps are skipped, so the
report names the first broken behaviour. Use `waitFor` for readiness polling.

## Isolation and failures

Docker acceptance uses temporary projects, synthetic credentials, isolated volumes
and ephemeral host ports, independently of the checkout's `.env` and normal Pi-box
resources. Sidecar tests may pull images and install disposable clients/exporters.

Runs clean up owned resources, including on failure. Set
`PI_BOX_KEEP_TEST_RESOURCES=1` to retain failing resources for inspection.
