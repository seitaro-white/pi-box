// Used only in a disposable, credential-free container by smoke.mjs.
import { readFileSync } from "node:fs";
import { createJiti } from "/opt/pi/node_modules/jiti/lib/jiti.mjs";

const packageDir = "/opt/pi/node_modules/@plannotator/pi-extension";
const jiti = createJiti(import.meta.url);
const { startPlanReviewServer } = await jiti.import(`${packageDir}/server.ts`);
await startPlanReviewServer({
  plan: "# Synthetic tunnel test\n\n- [ ] Verify loopback forwarding\n",
  htmlContent: readFileSync(`${packageDir}/plannotator.html`, "utf8"),
  sharingEnabled: false,
});
