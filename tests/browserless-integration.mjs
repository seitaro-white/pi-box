// Authenticated browser access from Pi; all resources belong to this test.
import assert from "node:assert/strict";
import { join } from "node:path";
import { withComposeProject } from "./helpers/compose-project.mjs";

await withComposeProject({
  name: "browserless",
  overlays: ["compose.browserless.yaml"],
}, async (p) => {
  const config = p.config();
  assert.equal(config.services.browser.ports, undefined);
  assert.ok(config.services.browser.environment.TOKEN === p.settings.BROWSER_TOKEN);
  assert.ok(config.services["pi-box"].environment.BROWSER_TOKEN === p.settings.BROWSER_TOKEN);
  p.make("up");
  const browser = p.inspect(p.compose(["ps", "--quiet", "browser"]));
  assert.equal(browser.State.Health.Status, "healthy");
  assert.deepEqual(browser.HostConfig.PortBindings || {}, {});
  p.compose(["cp", join(p.root, "tests/fixtures/browserless"), "pi-box:/tmp/browserless-client"]);
  p.compose(["exec", "-T", "pi-box", "cp", "-R", "/tmp/browserless-client", "/workspace/browserless-client"]);
  p.compose([
    "exec", "-T", "-w", "/workspace/browserless-client", "pi-box",
    "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
  ]);
  console.log(p.compose([
    "exec", "-T", "-w", "/workspace/browserless-client", "pi-box", "node", "check.mjs",
  ]));
});
