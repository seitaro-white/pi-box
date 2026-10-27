// Authenticated browser access from Pi; all resources belong to this test.
import { join } from "node:path";
import { expect } from "vitest";
import { incrementalSteps } from "../support/acceptance.mjs";
import { composeTest } from "../support/compose-project.mjs";

const test = composeTest({ name: "browserless", overlays: ["compose.browserless.yaml"] });
incrementalSteps();

const inClient = (p, args) => p.compose([
  "exec", "-T", "-w", "/workspace/browserless-client", "pi-box", ...args,
]);

test("configuration shares the token and publishes no browser port", ({ project: p }) => {
  const config = p.config();
  expect(config.services.browser.ports).toBeUndefined();
  // Compare without printing the token.
  expect(config.services.browser.environment.TOKEN === p.settings.BROWSER_TOKEN).toBe(true);
  expect(config.services["pi-box"].environment.BROWSER_TOKEN === p.settings.BROWSER_TOKEN).toBe(true);
});

test("make up starts a healthy, unpublished browser", ({ project: p }) => {
  p.make("up");
  const browser = p.inspect(p.compose(["ps", "--quiet", "browser"]));
  expect(browser.State.Health.Status).toBe("healthy");
  expect(browser.HostConfig.PortBindings || {}).toEqual({});
});

test("Pi drives a page it serves over authenticated CDP", ({ project: p }) => {
  p.compose(["cp", join(p.root, "tests/in-container/browserless"), "pi-box:/tmp/browserless-client"]);
  p.compose(["exec", "-T", "pi-box", "cp", "-R", "/tmp/browserless-client", "/workspace/browserless-client"]);
  inClient(p, ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  console.log(inClient(p, ["node", "check.mjs"]));
});
