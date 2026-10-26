// Run on stdin inside a disposable, credential-free smoke-test container.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "/opt/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

const profile = process.env.EXPECTED_PROFILE;
const piPackage = "@earendil-works/pi-coding-agent";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

test(`${profile}: exact package pins, extension loading and basic diagnostics`, async (t) => {
  assert(["base", "recommended"].includes(profile));
  const expectedManifest = JSON.parse(process.env.EXPECTED_MANIFEST_JSON);
  const expected = expectedManifest.dependencies;
  const manifest = readJson("/opt/pi/package.json");
  const npmTools = expectedManifest.piBox.npmTools;
  const extensions = Object.keys(expected).filter(
    (name) => name !== piPackage && !npmTools.includes(name),
  );
  assert.deepEqual(
    manifest.dependencies,
    profile === "base" ? { [piPackage]: expected[piPackage] } : expected,
  );

  // The image must not seed policy files before upstream extensions initialize.
  const agentDir = join(homedir(), ".pi", "agent");
  for (const file of [
    "extensions/subagent/config.json",
    "web-search.json",
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
      const pin = expected[name];
      if (pin.startsWith("git+")) {
        const locked = readJson("/opt/pi/package-lock.json").packages[`node_modules/${name}`];
        assert.equal(locked.resolved.replace("git+ssh://git@github.com/", "git+https://github.com/"), pin, name);
        assert.equal(readJson(path).version, locked.version, name);
      } else {
        assert.equal(readJson(path).version, pin, name);
      }
    }
  }

  const personalSkills = "/opt/pi/node_modules/personal-skills";
  assert.equal(existsSync(`${personalSkills}/package.json`), profile === "recommended");
  assert.equal(existsSync(`${personalSkills}/.git`), false);
  assert.equal(readJson("/opt/pi/package-lock.json").packages["node_modules/personal-skills"], undefined);

  // Prove guidance is actually discovered, even inside a project Git root and
  // alongside operator-owned global instructions in the persistent agent volume.
  const project = mkdtempSync('/workspace/guidance-');
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const git = spawnSync('git', ['init', '--quiet', project], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const operatorInstructions = join(agentDir, 'AGENTS.md');
  writeFileSync(operatorInstructions, 'Synthetic operator guidance.\n');
  const loader = new DefaultResourceLoader({ cwd: project, agentDir });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const guidance = loader.getAgentsFiles().agentsFiles.find((file) => file.path === '/AGENTS.md');
  assert(guidance, 'image-owned ancestor guidance is loaded');
  assert.equal(guidance.content, readFileSync('/AGENTS.md', 'utf8'));
  assert(guidance.content.trim(), 'image guidance is nonempty');
  const operatorGuidance = loader.getAgentsFiles().agentsFiles.find(
    (file) => file.path === operatorInstructions,
  );
  assert(operatorGuidance, 'personal guidance is loaded alongside image guidance');
  assert.equal(operatorGuidance.content, 'Synthetic operator guidance.\n');
  assert.equal(readFileSync(operatorInstructions, 'utf8'), operatorGuidance.content);
  const environmentSkills = loader.getSkills().skills.filter((skill) => skill.name === 'pi-box');
  assert.equal(environmentSkills.length, 1);
  assert.equal(environmentSkills[0].filePath, '/home/node/.agents/skills/pi-box/SKILL.md');
  assert(environmentSkills[0].description.trim(), 'environment skill has a description');
  assert.deepEqual(loader.getSkills().diagnostics, []);
  const herdrSkills = loader.getSkills().skills.filter((skill) => skill.name === "herdr");
  assert.equal(herdrSkills.length, profile === "recommended" ? 1 : 0);
  if (profile === "recommended") {
    const official = spawnSync("herdr", ["--skill"], { encoding: "utf8" });
    assert.equal(official.status, 0, official.stderr || official.error?.message);
    assert.equal(readFileSync(herdrSkills[0].filePath, "utf8"), official.stdout);
  }
  const hunkSkills = loader.getSkills().skills.filter((skill) => skill.name === "hunk-review");
  assert.equal(hunkSkills.length, profile === "recommended" ? 1 : 0);
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

  assert(session.systemPrompt.includes(guidance.content), 'image guidance reaches the model');
  assert(session.systemPrompt.includes(operatorGuidance.content), 'personal guidance reaches the model');
  assert(session.systemPrompt.includes(environmentSkills[0].filePath), 'environment skill is advertised');

  const errors = [];
  await session.bindExtensions({ onError: (error) => errors.push(error) });
  const tools = new Set(session.getAllTools().map((tool) => tool.name));
  const bundled = new Set(profile === "recommended" ? extensions : []);
  for (const [packageName, name] of [
    ["pi-subagents", "subagent"],
    ["pi-web-access", "fetch_content"],
    ["@narumitw/pi-lsp", "lsp_diagnostics"],
    ["@juicesharp/rpiv-ask-user-question", "ask_user_question"],
    ["@juicesharp/rpiv-todo", "todo"],
  ]) {
    assert.equal(tools.has(name), bundled.has(packageName), `tool ${name}`);
  }
  const loaded = loader.getExtensions().extensions;
  for (const name of bundled) {
    assert(
      loaded.some(
        (extension) =>
          extension.resolvedPath === `/opt/pi/node_modules/${name}` ||
          extension.resolvedPath.startsWith(`/opt/pi/node_modules/${name}/`),
      ) || loader.getSkills().skills.some(
        (skill) => skill.filePath.startsWith(`/opt/pi/node_modules/${name}/`),
      ),
      `extension or skill from ${name}`,
    );
  }
  assert.equal(
    loaded.some((extension) => extension.commands.has("usage")),
    bundled.has("@narumitw/pi-usage"),
    "/usage command",
  );
  assert.equal(
    loaded.some((extension) => extension.commands.has("calm")),
    bundled.has("pi-calm"),
    "/calm command",
  );
  for (const name of ["create-plan", "review-changes", "clean-up"]) {
    assert.equal(
      loader.getSkills().skills.some((skill) => skill.name === name),
      profile === "recommended",
      `personal skill ${name}`,
    );
  }
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
    writeFileSync(python, "import os\n");
    assert.match(await diagnostics("ruff", python), /F401/);
    const javascript = join(directory, "demo.mjs");
    writeFileSync(javascript, "let value = 1;\nconsole.log(value);\n");
    assert.match(await diagnostics("biome", javascript), /useConst/);
  }
  assert.deepEqual(errors, []);
  // LSP tools run only on synthetic files; no provider/model tools are invoked.
});
