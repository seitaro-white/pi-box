# Optional Browserless Chromium — trusted development only

Choose one selection in private `.env`, then run `chmod 600 .env` and `make up`:

```dotenv
# Pi + Browserless Chromium
COMPOSE_FILE=compose.yaml:compose.browserless.yaml
BROWSER_TOKEN='your-own-strong-private-token'

# Or Pi + PostgreSQL + Browserless Chromium:
# COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.browserless.yaml
# Also configure POSTGRES_PASSWORD and BROWSER_TOKEN privately.
```

[`compose.browserless.yaml`](../compose.browserless.yaml) pulls upstream Chromium
**v2.57.1**, pinned to its AMD64/ARM64 manifest digest. Neither Pi image installs
browser clients or browser packages. Upgrade the version/digest deliberately and
rerun acceptance; there is no project-owned browser image to build.

**License:** Browserless is [SSPL/commercial dual-licensed](https://github.com/browserless/browserless/blob/v2.57.1/LICENSE).
Its notice requires a commercial license for commercial applications and
closed-source CI. Confirm your own use is permitted; this project's intended
SSPL use was approved for adoption.

**Security:** the verified upstream launcher uses `--no-sandbox`;
`chrome://sandbox` reports no Chromium sandbox. This trade-off was explicitly
approved for trusted development. The non-root `blessuser` container uses init,
`no-new-privileges` and 2 GiB shared memory, without privileged mode, added
capabilities or unconfined policies. It has no published ports or mounts, but
has outbound networking and can reach Pi and other services. This is **not a
multi-tenant security boundary**. Keep tokens private: Docker administrators and
`docker compose config` can reveal them. Never log authenticated URLs.

## Discovery and client workflow

The Compose images include always-loaded environment instructions and the `pi-box`
skill, which tell Pi to connect using `BROWSER_CDP_URL` and `BROWSER_TOKEN` for
browser testing. No separate health check is needed: connect with a timeout and
diagnose any failure. Do not print the values or authenticated URLs/errors.

Browserless supplies the remote browser, **not a dedicated Pi browser tool**.
Writing a small Node or Python client script and executing it through the shell
is expected. Prefer existing project clients; for Node projects, `playwright-core`
is enough. Python Playwright's `chromium.connect_over_cdp()` is equally valid when
already available. Keep repeatable checks in project scripts/tests; temporary
scripts are fine for one-off inspection. No local browser download is needed.

Connect with `connectOverCDP()` / `connect_over_cdp()`, not `chromium.launch()`.
A local launch error such as missing `libglib-2.0.so.0` does not diagnose the
sidecar: it means a different browser was being launched inside Pi. Do not fix
that by installing local Chromium/libraries when a working sidecar is configured.

Install your own client in a project inside Pi (`npm install playwright-core@1.64.1`).
This JavaScript example saves client-side artifacts in Pi's `/workspace`:

```javascript
import { chromium } from 'playwright-core';

const url = new URL(process.env.BROWSER_CDP_URL);
url.searchParams.set('token', process.env.BROWSER_TOKEN);
const browser = await chromium.connectOverCDP(url.href);
try {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<button onclick="this.textContent=\'clicked\'">Click</button>');
    await page.getByRole('button').click();
    await page.screenshot({ path: '/workspace/page.png' });
    await page.pdf({ path: '/workspace/page.pdf' });
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}
```

CDP `browser.close()` disconnects the client; Browserless normally disposes the
session after disconnect. The upstream default session timeout is **30 seconds**
(concurrency 10, queue 10). No persistence across connections is promised; close
owned contexts and disconnect promptly. Acceptance verifies a fresh connection.

Browser `localhost` is the **browser container**, not Pi. For the default Compose
dev-server mapping, serve Pi applications on `0.0.0.0:5173` and visit
`http://pi-box:5173` from Browserless. The user's separate host browser opens
`http://localhost:5173` (remote users need an SSH tunnel); see
[web development and browser access](../README.md#web-development-and-browser-access).
Other internal ports can use `http://pi-box:PORT`, but require a matching published
port for host viewing. Pi files are not browser-side `file://`
files: serve them over HTTP or use `page.setContent()`. Client-saved artifacts
live in Pi, not the browser container.

A manual attach/navigation/cleanup check passed with **Stagehand 3.7.3** in a
disposable project (not an existing application), using this API:

```javascript
import { Stagehand } from '@browserbasehq/stagehand';
const url = new URL(process.env.BROWSER_CDP_URL);
url.searchParams.set('token', process.env.BROWSER_TOKEN);
const stagehand = new Stagehand({
  env: 'LOCAL', verbose: 0, disablePino: true,
  localBrowserLaunchOptions: { cdpUrl: url.href },
});
try {
  await stagehand.init();
  const page = await stagehand.context.newPage();
  await page.goto('data:text/html,<title>stagehand-check</title>');
  console.log(await page.title());
} finally {
  await stagehand.close();
}
```

Only attach/navigation/cleanup were checked, without model credentials or calls.
AI actions need separate model access. Stagehand 4 has a different API and is
not covered by this example. Stagehand is not an acceptance-test dependency.

Enabling the overlay may recreate Pi and end active sessions. To deselect it,
first run `docker compose stop browser` while it is still selected, then remove
the overlay from `.env` and run `make up`. `make replace` remains Pi-only.
See [upstream configuration docs](https://docs.browserless.io/enterprise/open-source)
for further options. GUI/browser-UI forwarding is separate and not included.

## Acceptance tests

Run `npm test` for Docker-free checks, then follow the [test guide](../tests/README.md)
to build images and run `npm run test:integration`. For Browserless alone, run
`npm run test:integration -- browserless` with a prebuilt recommended Pi image.
The Browserless test uses disposable containers, volumes and a token, and installs
a lockfile-pinned client only in disposable Pi. It checks authenticated CDP and
navigation to a Pi-served page. The separate `config` suite checks optional/combined
overlay wiring. No operator data or model credentials are used.

CI runs the same acceptance on native Linux AMD64 and ARM64 with Docker Compose
pinned to **v5.6.0**; the setup action logs the installed version.
