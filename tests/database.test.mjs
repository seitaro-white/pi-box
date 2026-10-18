import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-box-database-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("database credentials are private, random, separate and never printed or overwritten", (t) => {
  const dir = temporary(t);
  const file = join(dir, ".env.postgres");
  const run = () =>
    spawnSync(process.execPath, ["scripts/init-database.mjs"], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_ENV_FILE: file },
    });
  const created = run();
  assert.equal(created.status, 0, created.stderr);
  const contents = readFileSync(file, "utf8");
  assert.match(
    contents,
    /^POSTGRES_PASSWORD=[a-f0-9]{64}\nAPP_DB_PASSWORD=[a-f0-9]{64}\n$/,
  );
  const passwords = contents
    .trim()
    .split("\n")
    .map((line) => line.split("=")[1]);
  assert.notEqual(passwords[0], passwords[1]);
  for (const password of passwords)
    assert.ok(!(created.stdout + created.stderr).includes(password));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const repeated = run();
  assert.equal(repeated.status, 1);
  assert.match(repeated.stderr, /left unchanged/);
  assert.equal(readFileSync(file, "utf8"), contents);
  rmSync(file);
  const other = join(dir, "other");
  writeFileSync(other, "SYNTHETIC");
  symlinkSync(other, file);
  assert.equal(run().status, 1);
  assert.equal(readFileSync(other, "utf8"), "SYNTHETIC");
});

for (const database of ["0", "1"]) {
  test(`Make selects PostgreSQL only with DATABASE=${database}`, (t) => {
    const dir = temporary(t);
    writeFileSync(
      join(dir, "docker"),
      `#!${process.execPath}
console.log(JSON.stringify({ file: process.env.COMPOSE_FILE || "", envFile: process.env.COMPOSE_ENV_FILES || "" }));
`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.COMPOSE_FILE;
    delete env.COMPOSE_ENV_FILES;
    const result = spawnSync(
      "make",
      [
        "-s",
        "attach",
        `DATABASE=${database}`,
        "DATABASE_ENV_FILE=.env.test-postgres",
      ],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      JSON.parse(result.stdout),
      database === "1"
        ? {
            file: "compose.yaml:compose.postgres.yaml",
            envFile: ".env.test-postgres",
          }
        : { file: "compose.yaml", envFile: "" },
    );
  });
}

test("the default credential file is ignored by Git and excluded from image context", () => {
  const ignored = spawnSync("git", ["check-ignore", ".env.postgres"], {
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0, ignored.stderr);
  const dockerignore = readFileSync(".dockerignore", "utf8");
  assert.match(dockerignore, /^\*\*$/m);
  assert.doesNotMatch(dockerignore, /^!.*\.env/m);
});
