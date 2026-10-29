# Browserless Chromium

## Enable

Add to the host checkout's private `.env`, then run `chmod 600 .env` and `make up`:

```dotenv
COMPOSE_FILE=compose.yaml:compose.browserless.yaml
BROWSER_TOKEN='your-own-strong-private-token'
```

Append `:compose.browserless.yaml` to `COMPOSE_FILE` when combining overlays.
Starting overlays can recreate Pi and end active sessions.

Browserless is [SSPL/commercial licensed](https://github.com/browserless/browserless/blob/v2.57.1/LICENSE)
and runs Chromium with its sandbox disabled. Use it for trusted development and
check the license for your use. The service has no host ports or persistent storage.

## Use from Pi

Install a client in your project (`npm install playwright-core`), then connect
using `BROWSER_CDP_URL` and `BROWSER_TOKEN`. The sidecar provides Chromium;
no local browser installation or dedicated Pi browser tool is needed.

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

Keep authenticated URLs and raw connection errors private: they can contain the
token. Close contexts and disconnect after use; sessions default to 30 seconds.

Serve apps on `0.0.0.0` using a free port in `5173–5182` (check `ss -ltnp`).
For port 5173, Browserless visits `http://pi-box:5173` and the host browser visits
`http://localhost:5173`; substitute your selected port. Browser `localhost` refers to the
sidecar. Use HTTP or `page.setContent()` for Pi-local files; screenshots saved by
the client land in the Pi project directory.

## Stop and test

Run `docker compose stop browser` before removing the overlay from `.env`.

`npm run test:integration -- browserless` checks authenticated CDP, interaction,
PNG/PDF output and fresh sessions against a prebuilt recommended image. See the
[test guide](../tests/README.md) and [upstream configuration](https://docs.browserless.io/enterprise/open-source).
