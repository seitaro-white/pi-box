import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));

/** Read a JSON file without hiding missing or malformed files. */
export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
