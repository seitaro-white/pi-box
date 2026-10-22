import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const phoenix = readFileSync(
  new URL("../compose.phoenix.yaml", import.meta.url),
  "utf8",
);

test("Phoenix is an optional single-service SQLite backend with a pinned image", () => {
  const [services, volumes] = phoenix.split(/^volumes:/m);
  assert.deepEqual(
    [...services.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]),
    ["phoenix"],
  );
  assert.match(
    services,
    /image: docker\.io\/arizephoenix\/phoenix:version-20\.23\.0@sha256:[a-f0-9]{64}\b/,
  );
  assert.match(services, /PHOENIX_WORKING_DIR: \/mnt\/data/);
  assert.match(services, /- phoenix:\/mnt\/data/);
  assert.match(volumes, /^ {2}phoenix: \{\}$/m);
  assert.doesNotMatch(volumes, /\bname:/, "storage remains project-scoped");
  assert.doesNotMatch(
    services,
    /PHOENIX_SQL|POSTGRES|PGPASSWORD|API_KEY|\/workspace|\/home\/node|docker\.sock|depends_on:|container_name:/,
  );
});

test("Phoenix publishes only loopback UI/OTLP HTTP and has a bounded healthcheck", () => {
  assert.match(
    phoenix,
    /ports:\n {6}- "127\.0\.0\.1:\$\{PHOENIX_UI_PORT:-6006\}:6006"\n {4}healthcheck:/,
  );
  assert.doesNotMatch(phoenix, /4317|9090/);
  assert.match(phoenix, /cap_drop:\n {6}- ALL/);
  assert.match(phoenix, /no-new-privileges:true/);
  assert.match(phoenix, /http:\/\/127\.0\.0\.1:6006\/healthz/);
  assert.match(phoenix, /timeout=2/);
});

test("default Pi configuration never installs or enables observability", () => {
  for (const path of [
    "compose.yaml",
    "container/package.json",
    "container/base/package.json",
    "container/defaults/settings.json",
    "container/base/defaults/settings.json",
  ]) {
    assert.doesNotMatch(
      readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
      /phoenix|pi-otel|OTEL_|"otel"/,
    );
  }
  const example = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  assert.deepEqual(
    example.split("\n").filter((line) => /^COMPOSE_FILE=/.test(line)),
    ["COMPOSE_FILE=compose.yaml"],
  );
  assert.match(example, /^# COMPOSE_FILE=compose.yaml:compose.phoenix.yaml$/m);
  assert.match(
    example,
    /^# COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.phoenix.yaml$/m,
  );
  assert.match(
    example,
    /^# COMPOSE_FILE=compose.yaml:compose.browserless.yaml:compose.phoenix.yaml$/m,
  );
  assert.match(
    example,
    /^# COMPOSE_FILE=compose.yaml:compose.postgres.yaml:compose.browserless.yaml:compose.phoenix.yaml$/m,
  );
});

test("Phoenix setup remains discoverable after the README rewrite", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("[Phoenix guide](docs/phoenix.md)"));
  assert.ok(readme.includes("[Browserless guide](docs/browserless.md)"));
  const guide = readFileSync(
    new URL("../docs/phoenix.md", import.meta.url),
    "utf8",
  );
  const documentedSettings = JSON.parse(
    guide.match(/```json\n([\s\S]+?)\n\s*```/)[1],
  );
  const testedSettings = JSON.parse(
    readFileSync(
      new URL("fixtures/phoenix/settings.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(documentedSettings, testedSettings);
  assert.ok(guide.includes("pi install npm:pi-otel@0.3.0"));
});
