// Run on stdin inside a disposable, credential-free smoke-test container.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const profile = process.env.PI_BOX_PROFILE;
const piPackage = "@earendil-works/pi-coding-agent";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test(`${profile}: exact package pins and extension/tool/command registration`, async (t) => {
  assert(["base", "recommended"].includes(profile));
  const expected = JSON.parse(process.env.EXPECTED_DEPENDENCIES_JSON);
  const manifest = readJson("/opt/pi/package.json");
  const npmTools = ["@biomejs/biome"];
  const extensions = Object.keys(expected).filter(
    (name) => name !== piPackage && !npmTools.includes(name),
  );
  assert.deepEqual(
    manifest.dependencies,
    profile === "base" ? { [piPackage]: expected[piPackage] } : expected,
  );

  // The image must not seed policy files before upstream extensions initialize.
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  for (const file of [
    "extensions/subagent/config.json",
    "web-search.json",
    "plannotator.json",
    "pi-lsp.json",
  ]) {
    assert.equal(existsSync(`${agentDir}/${file}`), false, file);
  }
  for (const name of [...extensions, ...npmTools]) {
    const path = `/opt/pi/node_modules/${name}/package.json`;
    assert.equal(
      existsSync(path),
      profile === "recommended",
      `package presence for ${name}`,
    );
    if (profile === "recommended") {
      assert.equal(readJson(path).version, expected[name], name);
    }
  }

  const loader = new DefaultResourceLoader({ cwd: "/workspace", agentDir });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await createAgentSession({
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(),
  });
  t.after(async () => {
    try {
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
    } finally {
      session.dispose();
    }
  });

  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  const tools = new Set(session.getAllTools().map((tool) => tool.name));
  const bundled = new Set(profile === "recommended" ? extensions : []);
  for (const [packageName, names] of [
    ["pi-subagents", ["subagent", "bg_wait"]],
    ["pi-web-access", ["fetch_content", "get_search_content"]],
    ["@narumitw/pi-lsp", ["lsp_diagnostics", "lsp_fix"]],
    [
      "@plannotator/pi-extension",
      ["plannotator_submit_plan", "plannotator_mark_done"],
    ],
  ]) {
    for (const name of names) {
      assert.equal(tools.has(name), bundled.has(packageName), `tool ${name}`);
    }
  }
  const loaded = loader.getExtensions().extensions;
  for (const name of bundled) {
    assert(
      loaded.some(
        (extension) =>
          extension.resolvedPath === `/opt/pi/node_modules/${name}` ||
          extension.resolvedPath.startsWith(`/opt/pi/node_modules/${name}/`),
      ),
      `extension from ${name}`,
    );
  }
  assert.equal(
    loaded.some((extension) => extension.commands.has("usage")),
    bundled.has("@narumitw/pi-usage"),
    "/usage command",
  );
  for (const command of [
    "plannotator-plan-mode",
    "plannotator-review",
    "plannotator-annotate",
    "plannotator-last",
  ]) {
    assert.equal(
      loaded.some((extension) => extension.commands.has(command)),
      bundled.has("@plannotator/pi-extension"),
      `/${command} command`,
    );
  }
  assert.equal(process.env.PLANNOTATOR_REMOTE, undefined);
  assert.equal(process.env.PLANNOTATOR_PORT, undefined);
  assert.equal(
    existsSync("/opt/pi/node_modules/@plannotator/pi-extension"),
    false,
    "Plannotator is not bundled in the standard image",
  );
  assert.equal(
    loaded.some((extension) => extension.commands.has("lsp")),
    bundled.has("@narumitw/pi-lsp"),
    "/lsp command",
  );
  for (const command of ["ruff", "biome"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8" });
    if (profile === "base") {
      assert.equal(result.error?.code, "ENOENT", `${command} absent from base`);
    } else {
      assert.equal(result.status, 0, result.stderr || result.error?.message);
    }
  }
  assert.equal(existsSync("/opt/ruff"), profile === "recommended");
  if (profile === "recommended") {
    const directory = mkdtempSync(join(tmpdir(), "pi-box-lsp-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const run = (command, args) =>
      execFileSync(command, args, { cwd: directory, encoding: "utf8" });
    const tool = (name) => {
      const definition = session.agent.state.tools.find(
        (item) => item.name === name,
      );
      assert(definition, `active tool ${name}`);
      return definition;
    };
    const diagnostics = async (server, path) => {
      const result = await tool("lsp_diagnostics").execute(`smoke-${server}`, {
        server,
        root: directory,
        paths: [path],
        limit: 1,
      });
      assert.notEqual(result.isError, true);
      return result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
    };
    const python = join(directory, "demo.py");
    writeFileSync(python, "import os\n\nprint( 'Hello, Pi' )\n");
    assert.match(await diagnostics("ruff", python), /F401/);
    const fix = await tool("lsp_fix").execute("smoke-ruff-fix", {
      server: "ruff",
      root: directory,
      path: python,
      write: true,
    });
    assert.notEqual(fix.isError, true);
    assert.doesNotMatch(readFileSync(python, "utf8"), /import os/);
    run("ruff", ["format", python]);
    run("ruff", ["check", python]);
    run("ruff", ["format", "--check", python]);
    assert.match(await diagnostics("ruff", python), /no diagnostics/);
    assert.equal(run("python3", [python]).trim(), "Hello, Pi");

    const javascript = join(directory, "demo.mjs");
    writeFileSync(
      javascript,
      "let message='Hello, Pi'\nconsole.log( message )\n",
    );
    assert.match(await diagnostics("biome", javascript), /useConst/);
    run("biome", ["check", "--write", javascript]);
    run("biome", ["check", javascript]);
    assert.match(readFileSync(javascript, "utf8"), /const message/);
    assert.match(await diagnostics("biome", javascript), /no diagnostics/);
    assert.equal(run("node", [javascript]).trim(), "Hello, Pi");
  }
  assert.deepEqual(errors, []);
  // LSP tools run only on synthetic files; no provider/model tools are invoked.
});
