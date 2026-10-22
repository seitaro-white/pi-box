import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("native environment uses a local kit without host workspace or lifecycle commands", () => {
  const environment = read("sbxenv.yaml");
  assert.match(environment, /^schemaVersion: "1"$/m);
  assert.match(environment, /^name: pi-box$/m);
  assert.match(environment, /^agent: [\w.-]+$/m);
  assert.match(environment, /^kits:\n {2}- \.$/m);
  assert.match(environment, /^ {2}skills: off$/m);
  assert.doesNotMatch(environment, /^(workspace|additionalWorkspaces|lifecycle|secrets|bindings):/m);
});

test("kit leaves networking to host policy and model login to Pi", () => {
  const kit = read("pi-box.yaml");
  assert.match(kit, /^dockerfile: sandbox\/pi-box\.dockerfile$/m);
  assert.match(kit, /long-running@1/);
  assert.doesNotMatch(kit, /(?:network-policy|credential|ssh-agent|filesystem)@/);
});

test("standard image contexts exclude everything except reviewed build inputs", () => {
  const docker = read(".dockerignore");
  assert.equal(docker, read(".containerignore"));
  assert.match(docker, /^\*\*$/m);
  assert.match(docker, /^!pi-box\.yaml$/m);
  assert.match(docker, /^!sandbox\/pi-box\.dockerfile$/m);
  assert.doesNotMatch(docker, /^!.*(?:auth\.json|\.env|credentials|\.git\/|sbxenv)/m);
  const recipe = read("sandbox/pi-box.dockerfile");
  assert.match(recipe, /COPY container\/package\.json container\/package-lock\.json/);
  assert.doesNotMatch(recipe, /COPY\s+\.\s/);
});

test("image registers extensions at build time and leaves sessions to the user", () => {
  const recipe = read("sandbox/pi-box.dockerfile");
  assert.match(recipe, /USER agent\n[\s\S]*RUN node \/opt\/pi\/init-agent\.mjs/);
  assert.match(recipe, /ENTRYPOINT \[\]/);
  assert.match(recipe, /CMD \["\/bin\/bash", "-l"\]/);
  assert.doesNotMatch(recipe, /pi-box-launch|\/etc\/tmux\.conf/);
  assert.match(recipe, /umask 077/);
});

test("sandbox runtime uses default Pi and uv locations without optional policy overrides", () => {
  const recipe = read("sandbox/pi-box.dockerfile");
  const environment = recipe.match(/ENV HOME=([\s\S]*?)\nUSER agent/)[1];
  assert.doesNotMatch(environment, /\b(?:UV_\w+|PI_\w+)=/);
  assert.doesNotMatch(environment, /\.pi\/agent\/bin/);
  assert.match(environment, /PATH=\/home\/agent\/\.local\/bin:\$PATH/);
  assert.match(environment, /PAGER=batcat/);
});

test("Make retains Compose commands without a custom sandbox lifecycle wrapper", () => {
  const makefile = read("Makefile");
  assert.doesNotMatch(makefile, /sandbox\.mjs|sandbox-(?:create|start|shell|stop|validate)|\battach\b/);
});
