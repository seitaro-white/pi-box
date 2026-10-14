// Only prepare private storage; Git itself handles configuration and defaults.
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const config = process.env.GIT_CONFIG_GLOBAL;
if (!config) {
  throw new Error("GIT_CONFIG_GLOBAL must point into the Git volume");
}
const directory = dirname(config);
const credentials = join(directory, "credentials");

// Do not follow symlinks when creating files or changing their permissions.
for (const path of [directory, config, credentials]) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      continue;
    }
    throw error;
  }
  if (
    stat.isSymbolicLink() ||
    (path === directory ? !stat.isDirectory() : !stat.isFile())
  ) {
    throw new Error(`Refusing unexpected Git state path: ${path}`);
  }
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);

// An empty private file lets future git config writes retain mode 600,
// including commands run through docker exec (which has its own umask).
if (!existsSync(config)) {
  writeFileSync(config, "", { flag: "wx", mode: 0o600 });
}
for (const path of [config, credentials]) {
  if (existsSync(path)) {
    chmodSync(path, 0o600);
  }
}
