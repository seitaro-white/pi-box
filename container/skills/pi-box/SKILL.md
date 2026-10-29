---
name: pi-box
description: >-
  Operate inside Pi-box: filesystem and persistence, tool installation,
  optional services, web dev servers, browser testing/screenshots over Browserless CDP,
  and host/container boundaries. Use when doing any of these tasks, or any general task
  that requires understanding of the system you are in.
---

# Pi-box environment

Compose runs as `node`, home `/home/node`, projects in `/workspace`.
Check task-relevant tools and configuration: base/recommended images differ,
and sidecars are optional. Inspect configuration without printing secrets.

## Storage and tools

| Persistent Compose path | Contents |
|---|---|
| `/workspace` | Projects |
| `~/.pi/agent` | Pi settings, state and user packages; Claude Code state in `claude/` |
| `~/.config/git` | Git settings, HTTPS credentials and GitHub CLI login (`gh/`) |
| `~/.herdr` | Herdr state |

Other paths are container-local. uv Python/tool installs use the persistent agent
volume; project dependencies belong in the project. Volume contents survive
replacement, including file deletions. Docker Sandbox storage instead survives
stop/start but is lost on deletion unless host-directory sharing is configured.

Image builds, overlays, port publishing and container replacement are host-side
operations from the Pi-box checkout. Replacement ends running sessions. The host
home and Docker socket are not mounted by default.

## GitHub CLI

Use `gh` for GitHub PRs, issues, checks and API operations. Check `gh auth status`;
authentication uses `GH_TOKEN`, which can reuse the existing GitHub token. If
missing, ask the user to supply it privately in the shell launching Pi. Do not
print credentials or request them in chat. Leave Git's credential helper unchanged.
CLI config persists at `$GH_CONFIG_DIR` (`~/.config/git/gh`).

## Web development

Choose a free port in `5173–5182` using `ss -ltnp` and bind to `0.0.0.0`.
Disable automatic port fallback; retry another port if occupied. Report the URL.

For Vite, use the selected port in the dev script (5173 shown here):

```json
"dev": "vite --host 0.0.0.0 --port 5173 --strictPort"
```

| Client | App URL |
|---|---|
| Browserless | `http://pi-box:5173` |
| Docker host browser | `http://localhost:5173` |
| Remote browser | Forward host port over SSH, then open localhost |

Remote tunnel, run on the viewing machine:

```sh
ssh -N -L 127.0.0.1:5173:127.0.0.1:5173 your-docker-host
```

Substitute the selected port in these URLs and repeat `-L` for additional ports.
Host `.env` setting `DEV_PORTS` remaps the ten host ports; container ports remain
`5173–5182`.

## Optional services

Connect with bounded timeouts using supplied configuration. On failure, distinguish
missing configuration, a missing client and an unreachable service.

### PostgreSQL

Use `psql` or a project client with the supplied `PG*` variables; default address
is `postgres:5432`. This is a development administrator account with its own
persistent volume. Changing `.env` does not rotate an existing database password.

### Browserless Chromium

Use the project's browser client or install project-local `playwright-core`.
Connect with `chromium.connectOverCDP()` (Python: `connect_over_cdp()`); Chromium
runs in the sidecar, so local browser downloads and Linux browser libraries are
unnecessary. Missing `BROWSER_CDP_URL`/`BROWSER_TOKEN` means the user needs to
configure the browser overlay on the host.

Run a script from the project directory:

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
  console.error('Browser check failed; check app and sidecar availability.');
  process.exitCode = 1;
} finally {
  try {
    try {
      await context?.close();
    } finally {
      await browser?.close();
    }
  } catch {
    console.error('Browser cleanup failed.');
    process.exitCode = 1;
  }
}
```

Authenticated URLs and raw connection errors can expose tokens. Browser
`localhost` and `file://` refer to the sidecar; serve Pi files over HTTP or use
`page.setContent()`. Client-saved screenshots land in the project. Sessions default
to 30 seconds and are disposed on disconnect. Inspect screenshots for visual review.
The browser has no persistent storage; its disabled Chromium sandbox makes it
suitable for trusted development only.

### Phoenix

Internal address: `phoenix:6006`; host UI: `http://localhost:6006` (or forwarded
host port). Tracing requires separate `pi-otel` installation and configuration.
Full-content capture retains prompts, code, tool results and potentially secrets;
enable it only at the user's request.
