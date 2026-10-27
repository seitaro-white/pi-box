import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { root } from "../support/files.mjs";

const read = (path) => readFileSync(join(root, path), "utf8");

test("native environment uses a local kit without host workspace or injected secrets", () => {
  const environment = read("sbxenv.yaml");
  expect(environment).toMatch(/^name: pi-sandbox$/m);
  expect(environment).toMatch(/^kits:\n {2}- \.$/m);
  expect(environment).toMatch(/^ {2}skills: off$/m);
  expect(environment).not.toMatch(/^(workspace|additionalWorkspaces|secrets|bindings):/m);
});

test("kit selects the sandbox stage and leaves networking and model login alone", () => {
  const kit = read("pi-box.yaml");
  expect(kit).toMatch(/^dockerfile: Dockerfile$/m);
  // Kit v3 has no target field; the final stage is chosen by a build argument.
  expect(kit).toMatch(/^ {4}buildArg: PI_BOX_TARGET$/m);
  expect(kit).toMatch(/^ {4}default: sandbox$/m);
  expect(read("Dockerfile")).toMatch(/^ARG PI_BOX_TARGET=recommended\n[\s\S]*\nFROM \$\{PI_BOX_TARGET\}\n$/m);
  expect(kit).not.toMatch(/(?:network-policy|credential|ssh-agent|filesystem)@/);
});

test("image build contexts exclude everything except reviewed build inputs", () => {
  const docker = read(".dockerignore");
  expect(docker).toBe(read(".containerignore"));
  expect(docker).toMatch(/^\*\*$/m);
  expect(docker).toMatch(/^!pi-box\.yaml$/m);
  expect(docker).not.toMatch(/^!.*(?:auth\.json|\.env|credentials|\.git\/|sbxenv)/m);
  expect(read("Dockerfile")).not.toMatch(/COPY\s+\.\s/);
});
