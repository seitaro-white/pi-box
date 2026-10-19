# Issue #14: optional plain Chromium sidecar

Issue: https://github.com/seitaro-white/pi-box/issues/14

Status: implementation plan only; no runtime changes or validation performed.

## Scope

Add an opt-in, headless Chromium service that code inside Pi Box controls through CDP. Primary uses: Stagehand, scraping, PDFs, screenshots and ordinary browser checks.

- Follow the existing PostgreSQL Compose overlay pattern.
- Support Linux AMD64 and ARM64, including Docker Desktop on Apple Silicon.
- Keep browser binaries, libraries and fonts out of both Pi images. Projects install their own clients; no bundled Pi browser extension or extra system prompt.
- Initial version: one shared browser, no persistent profile, workspace/credential mounts, host-published ports, GUI, browser pool or cloud dependency.
- Browserless and a native Playwright server are out of scope. Issue #9's laptop browser-UI forwarding is separate.

## Implementation

### 1. Dedicated Chromium image

Add `container/chromium/Dockerfile` and minimal startup configuration. Use a digest-pinned, multi-architecture Debian slim base with supported Chromium packages; verify package availability on both architectures before selecting the release. Install Chromium, CA certificates, Latin/CJK fonts and only the utilities needed for startup and health checks. Distribution packages remain apt-managed, like existing Pi image tools; rebuild for security updates.

Use one documented local image tag, with no custom image-override mechanism for v1. Run headless as non-root, with Compose `init: true` for child reaping and initially 1 GiB shared memory.

Validate the Chromium sandbox under the intended container policy. Do not silently add `privileged`, `SYS_ADMIN` or `--no-sandbox`; if disabling the sandbox is necessary, explain the trade-off and obtain approval first.

Browser profile data stays in the container's writable layer. Recreation/removal discards it; stopping and restarting the same container need not erase it. No special reset-on-restart machinery is required.

### 2. Prove cross-container CDP access

Before finalizing launch settings, verify HTTP discovery (`/json/version`) and an actual client WebSocket connection from Pi. Check Chromium's listener binding, Host validation and advertised WebSocket address rather than assuming a debugging-address flag is sufficient.

Proposed connection variable: `BROWSER_CDP_URL=http://browser:9222`, an HTTP discovery base. Clients requiring a WebSocket URL resolve it from discovery; never hard-code Chromium's generated browser ID.

Only add a small forwarding/discovery helper if the chosen Chromium build actually requires it. Fix observed binding/Host/address issues, not a general proxy or compatibility layer. No automatic retries, reconnect service or broad Origin relaxation by default.

### 3. Add `compose.chromium.yaml`

- Add the separately built `browser` service, with a CDP discovery health check.
- Set `BROWSER_CDP_URL` on `pi` and wait for browser health when selected.
- Use the existing Compose network, no fixed container name and no browser volume.
- Publish no host ports and mount no Docker socket or Pi data into the browser.

CDP is unauthenticated control access for trusted peers on that network, not a multi-tenant security boundary. The browser needs outbound access and can reach other services on the Compose network.

### 4. Minimal lifecycle integration

Change `make build` from `docker compose build pi` to `docker compose build`, so `make up` builds all selected buildable services before its existing `--no-build` startup. PostgreSQL remains a pulled service.

Preserve build -> Pi preflight -> startup ordering. Leave `make replace` Pi-only (`--no-deps`) and retain the current readiness timeout unless testing demonstrates a problem. Make narrow build-context allowlist changes only if needed.

## Documentation

Update `README.md` and `.env.example` with:

```dotenv
# Pi + Chromium
COMPOSE_FILE=compose.yaml:compose.chromium.yaml

# Pi + PostgreSQL + Chromium
COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.chromium.yaml
```

Provide one working Playwright JavaScript example: connect over CDP, create an owned context/page, interact, save a screenshot/PDF into `/workspace`, close the context and disconnect without terminating the shared browser.

Add brief Stagehand guidance using `env: "LOCAL"` and a discovered WebSocket `cdpUrl`. Manually verify attach/use/cleanup against the existing Stagehand project and record the tested version and any limits; AI actions require separate model access. Do not add Stagehand as a test dependency. Defer separate Python/Puppeteer examples.

Keep operational notes short:

- One shared browser: use separate contexts and verify client cleanup does not close the browser for everyone.
- Browser `localhost` is the browser container. Serve apps on `0.0.0.0` in Pi and visit `http://pi:PORT`.
- Pi's files are not available through browser-side `file://`; serve them over HTTP or use `page.setContent()`. Screenshot/PDF bytes can be saved by the client in Pi; browser-side artifact paths are not shared automatically.
- Rediscover the WebSocket endpoint after browser restart. Scripts handle their own connection failures; no reconnect machinery is supplied.
- Enabling the overlay can recreate Pi and end active sessions. Stop the browser before removing its overlay from `.env`; removing an overlay does not stop its existing container.
- CDP is Chromium-only and not full native Playwright protocol compatibility.

## Minimal validation

Keep host tests dependency-free. Add a focused command-stub check for the selected-services build change and preserve existing preflight-ordering coverage.

Check resolved Compose configuration for default browser absence and the combined PostgreSQL/Chromium selection; do not repeat PostgreSQL CRUD/persistence or Pi replacement tests.

Add one focused `tests/chromium-integration.mjs` using uniquely named disposable resources and an isolated, pinned Playwright client fixture, not a production Pi dependency:

1. Start the selected services and verify browser health, non-root execution, intended security settings, no published ports and no sensitive mounts.
2. Connect from Pi using the documented discovery path.
3. Visit a synthetic page served by Pi, perform a DOM action and verify the result.
4. Save and validate a PNG and PDF in Pi's disposable workspace.
5. Close the owned context/client, then connect again successfully to confirm cleanup left the shared browser usable.

Follow existing owned-resource cleanup/retain-on-failure conventions. No model calls or operator data. Defer cookie-isolation, browser-recreation and automated Stagehand suites; we are not implementing those client/browser features.

Build the same browser image and run this focused test in native AMD64/ARM64 CI; wire it into `tests/integration.mjs`. Run existing host/integration suites for regressions without expanding their scope.

## Delivery sequence

1. Prove browser availability, sandbox policy, CDP reachability and client cleanup using disposable resources.
2. Add the image, Compose overlay and one-line build change.
3. Add the focused test and architecture CI coverage.
4. Add verified usage documentation and perform the manual Stagehand check.

Done: optional startup works through `make up`, code in Pi controls Chromium and saves artifacts, default Pi-only behavior stays unchanged, and both architectures pass. Report any unverified Stagehand behavior explicitly.
