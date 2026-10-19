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

Browser `localhost` is the **browser container**, not Pi. Serve Pi applications
on `0.0.0.0` and visit `http://pi-box:PORT`. Pi files are not browser-side `file://`
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

After building both Pi image variants, run `npm run test:integration` for the
host, image smoke, Compose, PostgreSQL and Browserless suites. For Browserless
alone, run `PI_BOX_RECOMMENDED_IMAGE=pi-box:0.2.0 node tests/browserless-integration.mjs`.
The Browserless test uses disposable containers, volumes and a token, and installs
a lockfile-pinned client only in disposable Pi. It checks optional/combined
configuration, health, missing-token rejection, DOM interaction, PNG/PDF output
and a fresh browser session. It does not use operator data or model credentials.

CI runs the same acceptance on native Linux AMD64 and ARM64 with Docker Compose
pinned to **v5.6.0**; the setup action logs the installed version.
