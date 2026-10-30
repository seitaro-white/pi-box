import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native environment uses a local kit without host workspace or injected secrets", () => {
  const environment = read("sbxenv.yaml");
  assert.match(environment, /^name: pi-sandbox$/m);
  assert.match(environment, /^kits:\n {2}- \.$/m);
  assert.match(environment, /^ {2}skills: off$/m);
  assert.doesNotMatch(environment, /^(workspace|additionalWorkspaces|secrets|bindings):/m);
});

test("kit leaves networking to host policy and model login to Pi", () => {
  const kit = read("pi-box.yaml");
  assert.match(kit, /^dockerfile: Dockerfile$/m);
  assert.match(kit, /^ {4}buildArg: PI_BOX_TARGET$/m);
  assert.match(kit, /^ {4}default: sandbox$/m);
  assert.match(read("Dockerfile"), /^ARG PI_BOX_TARGET=recommended\n[\s\S]*\nFROM \$\{PI_BOX_TARGET\}\n$/m);
  assert.doesNotMatch(kit, /(?:network-policy|credential|ssh-agent|filesystem)@/);
});

test("standard image contexts exclude everything except reviewed build inputs", () => {
  const docker = read(".dockerignore");
  assert.equal(docker, read(".containerignore"));
  assert.match(docker, /^\*\*$/m);
  assert.match(docker, /^!pi-box\.yaml$/m);
  assert.match(docker, /^!container\/defaults\/micro-settings\.json$/m);
  assert.match(docker, /^!container\/extensions\/\ncontainer\/extensions\/\*\*\n!container\/extensions\/herdr-question-state\.ts$/m);
  assert.doesNotMatch(docker, /^!.*(?:auth\.json|\.env|credentials|\.git\/|sbxenv)/m);
  const recipe = read("Dockerfile");
  assert.doesNotMatch(recipe, /COPY\s+\.\s/);
});
