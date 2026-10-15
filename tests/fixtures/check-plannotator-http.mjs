// Host-side probe of the real Plannotator UI through Docker's loopback mapping.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const url = `http://${process.argv[2]}`;
let response;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (response.ok) break;
  } catch {
    // Extension loading can take a few seconds on a fresh container.
  }
  await delay(1000);
}
assert.ok(response?.ok, "published Plannotator UI becomes reachable");
assert.match(await response.text(), /<html/i, "bundled browser UI");
const plan = await fetch(`${url}/api/plan`, { signal: AbortSignal.timeout(5000) });
assert.equal(plan.status, 200);
assert.match((await plan.json()).plan, /Synthetic tunnel test/);
console.log("PASS: real Plannotator UI and plan API through host loopback publishing");
