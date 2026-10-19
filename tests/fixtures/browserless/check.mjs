import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright-core";

// Never expose token-bearing third-party errors in test output.
try {
	// No external sites, model calls or operator data.
	await assert.rejects(
		chromium.connectOverCDP(process.env.BROWSER_CDP_URL, { timeout: 5000 }),
		/401/,
	);
	const url = new URL(process.env.BROWSER_CDP_URL);
	url.searchParams.set("token", process.env.BROWSER_TOKEN);
	const server = createServer((_req, res) => {
		res.setHeader("Content-Type", "text/html");
		res.end("<button onclick=\"this.textContent='clicked'\">click me</button>");
	});
	await new Promise((resolve) => server.listen(8123, "0.0.0.0", resolve));
	try {
		for (let session = 0; session < 2; session++) {
			const browser = await chromium.connectOverCDP(url.href, {
				timeout: 15000,
			});
			try {
				const context = await browser.newContext();
				try {
					const page = await context.newPage();
					await page.goto("http://pi:8123");
					await page.getByRole("button").click();
					assert.equal(await page.getByRole("button").textContent(), "clicked");
					if (session === 0) {
						await page.screenshot({ path: "/workspace/browserless.png" });
						await page.pdf({ path: "/workspace/browserless.pdf" });
						const png = await readFile("/workspace/browserless.png");
						assert.equal(
							png.subarray(0, 8).toString("hex"),
							"89504e470d0a1a0a",
						);
						assert.ok(png.length > 100);
						const pdf = await readFile("/workspace/browserless.pdf");
						assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
						assert.ok(pdf.length > 100);
					}
				} finally {
					await context.close();
				}
			} finally {
				// CDP close disconnects the client; Browserless disposes its session.
				await browser.close();
			}
		}
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
	console.log(
		"PASS: auth rejection, DOM action, PNG/PDF and fresh Browserless session",
	);
} catch {
	console.error(
		"Browserless client check failed (credential-bearing error suppressed).",
	);
	process.exitCode = 1;
}
