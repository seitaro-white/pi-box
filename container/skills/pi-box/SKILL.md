---
name: pi-box
description: >-
  Operate inside the Pi-box development environment: filesystem layout,
  persistence, tool installation, optional sidecar connections, and
  host/container boundaries. Use when starting web dev servers, forwarding
  ports, taking screenshots, running browser tests through Browserless CDP,
  troubleshooting the environment, installing tools, connecting to services,
  or determining what survives a restart or replacement.
---

# Pi-box environment guide

## Establish the current environment

Pi-box normally runs as the non-root `node` user, with home directory
`/home/node` and projects under `/workspace`.

There are multiple deployment modes and image variants. Treat this guide
as the default architecture, not proof of the current configuration.

Before environment-specific work:
- Check the current directory, user, and relevant installed tools.
- Check only the environment variables needed for the task.
- Distinguish a missing client, missing configuration, and unreachable
  service before recommending changes.
- Do not dump the environment, credential files, or connection URLs:
  they may contain secrets.

The recommended image includes more tools and integrations than the base
image. Optional sidecars are not necessarily enabled.

## Filesystem and persistence

For the default Docker Compose deployment:

| Location | Purpose | Survives container replacement? |
|---|---|---|
| `/workspace` | Projects and working files | Yes, in the workspace volume |
| `/home/node/.pi/agent` | Pi state, settings and user packages | Yes, in the agent volume |
| `/home/node/.config/git` | Git settings and HTTPS credentials | Yes, in the Git volume |
| `/home/node/.herdr` | Herdr state | Yes, in the Herdr volume |
| Other container paths | Image files and temporary/local changes | Do not assume so |

Persistence is not a backup. Deleting files in a mounted volume deletes
the persistent copies too.

The optional Docker Sandbox deployment has different storage semantics:
its default internal storage survives stop/start, but not sandbox deletion.
Shared host-directory storage is an opt-in alternative. Confirm the
deployment and mounts before promising that data will survive.

Do not assume the Pi-box source repository or its documentation is
available inside the running container.

## Host and container boundaries

The default Compose container:
- Runs without root privileges and with Linux capabilities dropped.
- Does not mount the host home directory or Docker socket.
- Can access mounted files and make outbound network requests.
- Can therefore still damage project data or expose accessible secrets.

Do not assume `sudo`, Docker access, host paths, or host administration
are available. Do not try to bypass isolation to complete a task.

Building images, changing Compose overlays, publishing ports, and
recreating containers are normally host-side operations. When needed,
explain the required host action and give the user commands with an
explicit working-directory requirement.

Do not recommend container replacement without warning that it ends
running sessions. Destructive volume operations require explicit approval.

## Web development and port forwarding

Run the project's web server on **`0.0.0.0:5173`** for the default Compose
mapping. Save the binding in its normal dev script/config; for Vite:
`"dev": "vite --host 0.0.0.0 --port 5173 --strictPort"`. If the project needs
another port, ask for a matching host-side Compose mapping instead of silently
changing the project's convention or falling back to an unpublished port.

The browser sidecar and the user's browser are separate clients of the same app:
- **Pi's Browserless browser:** open `http://pi-box:5173` over the Docker network.
- **User on the Docker host:** open `http://localhost:5173`, published on host
  loopback only. Host `.env` setting `DEV_PORT` changes this host port, not 5173
  inside Pi.
- **User on another machine:** forward the Docker host's loopback port through
  their existing SSH connection, then open localhost there. For example, on the
  viewing machine: `ssh -N -L 127.0.0.1:5173:127.0.0.1:5173 your-docker-host`.

Port publishing is managed on the host; these mappings do not apply to Docker
Sandboxes. Never claim visual review passed based only on an HTTP check.

## Connecting to optional services

Inside Compose, use service DNS names—not `localhost`.

Connect directly using the supplied configuration, with a timeout. If it fails,
distinguish missing configuration, a missing client and an unreachable service;
report the failure without exposing credentials.

### PostgreSQL

- Default service address: `postgres:5432`.
- Use the supplied `PG*` environment variables with `psql` or a client.
- Do not print `PGPASSWORD` or embed credentials in command arguments.
- No database port is published to the host by default.
- The development account has database administrator privileges.

Keep this separate from production data. Get approval before destructive
database operations.

PostgreSQL data lives in its own persistent volume. Changing the configured
password does not rotate the password of an existing database.

### Browserless Chromium

- Connect using `BROWSER_CDP_URL` and `BROWSER_TOKEN`; no separate health check
  is needed. If they are missing, ask the user to enable the browser overlay.
- Default service address: `browser:3000`; use the configured URL, not a guess.
- The Pi image has no local Chromium or browser client. Missing Linux browser
  libraries usually mean an incorrect local launch, not a broken sidecar.
- Use `chromium.connectOverCDP()` (Python: `connect_over_cdp()`), never
  `chromium.launch()` for this sidecar. Do not run `playwright install`, install
  Linux browser libraries, or fall back to a local browser without approval.
- Prefer the project's existing browser client. For Node projects without one,
  `playwright-core` is sufficient; no downloaded browser is needed. Keep client
  dependencies project-local and follow the project's dependency policy.
- A small script run through the shell is the expected client workflow; no
  dedicated browser tool is bundled. Python Playwright is also valid if already
  available. Keep reusable checks in project scripts/tests; use temporary scripts
  for one-off inspection and clean them up when done.
- Treat the authenticated URL as a secret. Build it from environment variables
  in the script; never hard-code tokens or pass authenticated URLs as shell args.
  Do not echo raw connection errors/debug logs that may contain the URL.
- Use bounded connect/navigation timeouts. Report a sanitized failure instead of
  repeatedly installing browsers. The upstream default session limit is 30 seconds.
- Browser `localhost` means the browser sidecar, not Pi. Visit Pi-served apps at
  `http://pi-box:5173`; serve files over HTTP or use `page.setContent()` instead
  of assuming Pi's `file://` paths are available to the browser.
- Save screenshots to the project in `/workspace`; close owned contexts and
  disconnect in `finally`. Browserless normally disposes sessions on disconnect.

Minimal Node client (requires project-local `playwright-core`):

```javascript
import { chromium } from 'playwright-core';

const url = new URL(process.env.BROWSER_CDP_URL);
url.searchParams.set('token', process.env.BROWSER_TOKEN);
let browser;
let context;
try {
  browser = await chromium.connectOverCDP(url.href, { timeout: 10_000 });
  context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://pi-box:5173', { timeout: 15_000 });
  await page.screenshot({ path: 'page.png', fullPage: true });
} catch {
  // Do not print the underlying exception: it can include the authenticated URL.
  console.error('Browser check failed; inspect app and sidecar availability without logging credentials.');
  process.exitCode = 1;
} finally {
  try {
    try {
      if (context) await context.close();
    } finally {
      if (browser) await browser.close();
    }
  } catch {
    console.error('Browser cleanup failed (connection details omitted).');
    process.exitCode = 1;
  }
}
```

Run from the project directory so the artifact path is inside `/workspace`. Never claim visual review passed just because an HTTP request succeeded.

The default service has no persistent storage and publishes no host port.
It is intended for trusted development; upstream disables Chromium's
sandbox. Do not treat it as a safe environment for hostile content.

### Phoenix tracing

- Default internal service address: `phoenix:6006`.
- Starting Phoenix does not automatically enable Pi tracing.
- Exporter installation and configuration are separate, explicit steps.
- Do not enable full-content capture without user approval: traces can
  retain prompts, code, tool results, and secrets.

The Compose UI is exposed on the Docker host's loopback interface by
default. A user's browser needs the host-side address or an SSH tunnel,
not the internal Compose hostname.
