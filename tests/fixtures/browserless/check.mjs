import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

// The harness captures failures and redacts the disposable token from diagnostics.
await assert.rejects(
  chromium.connectOverCDP(process.env.BROWSER_CDP_URL, { timeout: 5000 }),
  /401/,
);
const url = new URL(process.env.BROWSER_CDP_URL);
url.searchParams.set("token", process.env.BROWSER_TOKEN);
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<title>Pi Box browser acceptance</title>");
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(8123, "0.0.0.0", resolve);
});
try {
  const browser = await chromium.connectOverCDP(url.href, { timeout: 15000 });
  try {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("http://pi-box:8123", { timeout: 15000 });
      assert.equal(await page.title(), "Pi Box browser acceptance");
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
console.log("PASS: missing-token rejection and authenticated CDP navigation to Pi-served page.");
