# Issue #14: optional Browserless Chromium sidecar

Issue: https://github.com/seitaro-white/pi-box/issues/14

Status: Browserless implemented and verified on native ARM64 Docker Desktop.
Native AMD64 acceptance remains pending CI; no emulation result is claimed.
The custom Chromium implementation remains reverted.

## Goal and scope

Let code in Pi use a local headless browser for Stagehand, scraping, screenshots,
PDFs and ordinary browser checks, with minimal project-owned maintenance.

Pull `ghcr.io/browserless/chromium`, like the existing PostgreSQL service. Support
AMD64 and ARM64, including Docker Desktop on Apple Silicon. Projects install
their own clients; neither Pi image gains browser dependencies or extensions.

MVP deliverables: one Compose overlay, `.env.example`/README updates, one focused
integration test with an isolated client fixture, and a small addition to existing
CI. No custom image, startup script, proxy, seccomp profile or Makefile changes.
No host-published ports, browser mounts, persistent profiles, GUI or cloud service.
Issue #9's laptop browser-UI forwarding remains separate.

## 1. Small upstream compatibility check

Before implementing, use disposable resources to:

- Select a maintained image version and pin its multi-architecture manifest
  digest. Confirm AMD64/ARM64 availability.
- Review its license. Browserless currently publishes SSPL/commercial terms;
  confirm that the intended use is acceptable before adopting it.
  Source: https://github.com/browserless/browserless/blob/main/LICENSE
- Start it using upstream guidance, check its user/container requirements and
  actual Chromium sandbox status, and connect from Pi using Playwright CDP.
  Record the security posture once; no general-purpose security audit tooling.
- Do not silently accept a disabled Chromium sandbox, privileged mode, SYS_ADMIN
  or an unconfined policy. Obtain approval for any such trade-off. If compatibility
  needs our own image/helper/security profile, stop and discuss rather than
  rebuilding the custom runtime.

This is only a compatibility check, not a second copy of the acceptance suite.
Reference: https://docs.browserless.io/enterprise/open-source

## 2. Minimal Compose integration

Add `compose.browserless.yaml` with service name `browser`:

- Use the selected upstream version/digest directly with `image:`, no `build:`.
- Use the existing Compose network, no fixed container name, published ports or
  mounts. The browser needs outbound access and can reach other services.
- Require a manually configured `BROWSER_TOKEN` in private `.env`; pass it to
  Browserless as `TOKEN` and to Pi as `BROWSER_TOKEN`.
- Give Pi `BROWSER_CDP_URL=ws://browser:3000/chromium`, subject to verification
  against the pinned image. This is a credential-free WebSocket base; clients
  add the token with URL/query APIs. No Chromium browser-ID discovery helper.
- Use upstream concurrency, queue and session-timeout defaults. Tune only if
  normal use or testing demonstrates a problem; record any necessary change.
- Set shared memory per upstream guidance (currently 2 GiB), and apply the
  compatible init/security settings established by the check above.
- Add a health check using tools already in the image and its supported liveness
  endpoint (currently `/active`). Verify auth/status requirements. Pi waits for
  browser health when the overlay is selected.

Keep the Makefile unchanged: only Pi needs building. Existing `make up` builds
Pi, preflights it, pulls missing sidecar images and waits for selected services.
Keep the current readiness timeout unless testing demonstrates a problem.
`make replace` remains Pi-only with `--no-deps`.

Use Browserless's normal session lifecycle, not the former plan's shared-browser
process assumptions. Do not add session persistence, reconnect logic or custom
pool management.

## 3. Brief usage documentation

Update `README.md` and `.env.example` with these alternative selections:

```dotenv
# Pi + Browserless Chromium
COMPOSE_FILE=compose.yaml:compose.browserless.yaml
BROWSER_TOKEN='your-own-strong-private-token'

# Pi + PostgreSQL + Browserless Chromium
COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.browserless.yaml
# Also configure POSTGRES_PASSWORD and BROWSER_TOKEN privately.
```

Include only:

- Pulled-image setup, applicable license/security notes, tested image version,
  and deliberate version/digest updates rather than browser-package builds.
- One working Playwright JavaScript example: construct the authenticated URL,
  connect, create an owned context/page, interact, save PNG/PDF into `/workspace`,
  and clean up using the verified session semantics. Do not log token-bearing URLs.
- One manual Stagehand attach → navigate → cleanup check, recording the exact
  tested version/API. Use the existing project if available, otherwise a
  disposable project and report that limit. No version matrix, model calls or
  Stagehand test dependency; AI actions need separate model access.
- The selected image's session timeout and normal cleanup behavior; no promise
  of persistent state across connections.
- Browser `localhost` means the browser container. Serve Pi apps on `0.0.0.0`
  and visit `http://pi:PORT`. Pi files are not browser-side `file://` files; use
  HTTP or `page.setContent()`. Client-saved artifacts live in Pi.
- Keep tokens private. This is a trusted-development service, not a multi-tenant
  security boundary. Enabling the overlay can recreate Pi and end sessions;
  stop `browser` before deselecting the overlay.

Link upstream docs for further configuration. Defer additional client examples,
REST APIs and operational features until there is a demonstrated need.

## 4. One focused acceptance test and existing CI

Keep host tests dependency-free and existing preflight-ordering coverage intact.
Add `tests/browserless-integration.mjs`, wired into `tests/integration.mjs`:

1. Check resolved Compose config: browser/token absent by default; combined
   PostgreSQL/Browserless selection retains both dependencies/settings and adds
   no browser host ports or mounts.
2. Start uniquely named disposable services through existing Make/Compose
   lifecycle with a disposable token and volumes. Check health and the agreed
   basic container settings, without building a general runtime audit.
3. Install a lockfile-pinned Playwright fixture only inside disposable Pi, not
   as a production dependency. Make one bounded missing-token rejection check.
4. Connect with the documented URL, visit a synthetic page served by Pi, perform
   a DOM action, and save/validate PNG and PDF artifacts in Pi's workspace.
5. Clean up the owned context/client, then connect and use a fresh session to
   confirm the service remains usable. No persistence or concurrency suite.

Follow existing owned-resource cleanup/retain-on-failure conventions. No operator
data or model access. Do not duplicate PostgreSQL CRUD/persistence or Pi
replacement tests; run their existing suites for regressions.

Extend the existing native AMD64/ARM64 CI matrix to pull the same pinned
Browserless image and run this test. No browser build job or new CI framework.
Run host tests, both Pi smoke suites and existing Compose/PostgreSQL suites.
Report native architecture results explicitly; emulation is not native proof.

## Verification record

- Operator confirmed SSPL acceptable for intended usage and explicitly approved
  upstream's disabled Chromium sandbox before implementation.
- Selected `ghcr.io/browserless/chromium:v2.57.1`, manifest digest
  `sha256:93dc614e2532ee66bac78f68b6229c33392309293c626d2a0899ccdf0c8aac67`.
  Registry inspection confirmed native linux/amd64 and linux/arm64 manifests.
- Native ARM64 compatibility check: upstream `blessuser`, init,
  no-new-privileges, 2 GiB shm; no privileged/SYS_ADMIN/unconfined settings.
  CDP `/chromium` works. `chrome://sandbox` reports all sandbox layers disabled.
  `/active` returns 401 without token and 204 with token. No tuning required.
- Native ARM64 acceptance passed: optional/combined configuration, health and
  container settings, missing-token rejection, Pi-served DOM action, PNG/PDF,
  owned-context cleanup/disconnect and a fresh session. Disposable fixture uses
  lockfile-pinned playwright-core 1.64.1, installed only in disposable Pi.
- Manual Stagehand 3.7.3 check passed in a disposable project: LOCAL mode,
  localBrowserLaunchOptions.cdpUrl, init, context.newPage, data-URL navigation,
  title assertion and close. No existing application or model calls tested.
  Stagehand 4's changed API is not covered.
- Full integration runner passed on ARM64: host tests, both Pi smoke suites,
  Compose, PostgreSQL and Browserless. Recommended image `pi-box:0.2.0`;
  base image `pi-box:personal-rebased-base-check` (prebuilt local images).
- Existing native AMD64/ARM64 CI matrix now runs Browserless acceptance using
  the same pinned overlay. CI has not been run from this local session; native
  AMD64 results and fresh CI builds remain unverified.
- Disposable compatibility/failed-attempt resources were cleaned after fixing
  fixture copy ownership; no operator containers, configuration or volumes changed.

## Completion

Optional `make up` startup works; Pi clients interact with pages and save
artifacts; cleanup permits a fresh connection; default Pi-only behavior stays
unchanged; native AMD64/ARM64 acceptance passes. Record the small manual
Stagehand check and any unverified behavior. No project-owned browser runtime
should remain.
