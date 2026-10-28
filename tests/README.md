# Tests

Tests use [Vitest](https://vitest.dev/). Run `npm ci` once to install it.

## Run

```sh
npm test                           # unit tests: no Docker

# Build images before acceptance:
docker build --target base -t pi-box:0.2.0-base .
docker build --target recommended -t pi-box:0.2.0 .
docker build --target sandbox -t pi-box:0.2.0-sandbox .
npm run test:integration           # all default acceptance files

# Select files by name, or tests by name with -t:
npm run test:integration -- postgres browserless
npm run test:integration -- compose -t "make replace"

npm run test:phoenix               # opt-in: installs pi-otel, keeps traces
npm run test:sandbox-live          # opt-in, macOS host: an existing Docker Sandbox
```

CI runs `npm test` and `npm run test:integration` on native AMD64/ARM64.
Override image names with `PI_BOX_BASE_IMAGE`, `PI_BOX_RECOMMENDED_IMAGE` and
`PI_BOX_SANDBOX_IMAGE`. `vitest.config.mjs` defines the four projects.

## Layout

| Path | Contents |
|---|---|
| `unit/` | State preservation, replacement guards, manifest/lockfile consistency, sandbox definitions |
| `acceptance/compose-config`, `compose-dev-port` | Overlay combinations, storage and port wiring |
| `acceptance/base-image`, `recommended-image` | Image tools, permissions, Pi guidance/skills, extensions and LSP |
| `acceptance/herdr` | Reporter installation, offline extension loading and persistent Herdr state |
| `acceptance/compose` | Make/Compose lifecycle, dev port, replacement and persistent Pi/workspace/Git state |
| `acceptance/postgres` | SQL connectivity and persistence |
| `acceptance/browserless` | Authenticated CDP, Pi-served page interaction and artifacts |
| `acceptance/phoenix` | Synthetic Pi traces and Phoenix persistence (opt-in) |
| `acceptance/sandbox-image` | Sandbox image without sbx or credentials |
| `acceptance/sandbox-live` | An existing sandbox (opt-in); `PI_BOX_SANDBOX_RESTART=1` also stops it, ending sessions |
| `support/` | Fixtures and helpers shared by tests |
| `in-container/` | Scripts and clients piped or copied into containers under test |

## Writing tests

Tests request fixtures by name, as in pytest:

- `support/fixtures.mjs` is the unit tests' `conftest.py`: `tmpDir` (like
  `tmp_path`) and `agentState` (synthetic Pi state plus the real initializer).
- `composeTest({ name, overlays, settings })` returns a `test` with a
  file-scoped `project` fixture: a private, disposable Compose project.
- `defineImageSmoke(profile)` defines the image smoke steps around a
  file-scoped `container` fixture.

Use `test.for` to parametrize. Acceptance files that build on earlier steps call
`incrementalSteps()`: tests run in order and, after one fails, the rest are
skipped, so the report names the first broken behaviour. Use `waitFor` for
readiness polling.

`vitest list` parses files statically by default, so parametrized names show
their `$placeholders`; add `--staticParse=false` to see real names.

## Isolation and failures

Docker acceptance uses temporary projects, synthetic credentials, isolated volumes
and ephemeral host ports, independently of the checkout's `.env` and normal Pi-box
resources. Sidecar tests may pull images and install disposable clients/exporters.

Runs clean up owned resources, including on failure and Ctrl-C. Set
`PI_BOX_KEEP_TEST_RESOURCES=1` to retain a failing file's resources for
inspection. Generated secrets are redacted from command errors and failure output.
