// Only the recommended image calls this initializer. Symlinks in that image
// route Herdr's standard config/state paths into the existing agent volume.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dir = join(homedir(), ".pi", "agent", "herdr");
for (const name of ["config", "state"]) {
  mkdirSync(join(dir, name), { recursive: true, mode: 0o700 });
}
try {
  writeFileSync(
    join(dir, "config", "config.toml"),
    readFileSync(new URL("./defaults/herdr.toml", import.meta.url)),
    { flag: "wx", mode: 0o600 },
  );
} catch (error) {
  // Existing config is operator-owned; never rewrite it on startup/upgrade.
  if (error.code !== "EEXIST") throw error;
}
