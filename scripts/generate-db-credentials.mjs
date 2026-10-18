// Append machine-local credentials without changing Compose selection or rotating
// passwords already configured for an existing database.
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

try {
  const environmentFilePath = process.argv[2] || ".env";
  let existingConfiguration = "";
  let environmentFileExists = false;
  try {
    const environmentFileStatus = lstatSync(environmentFilePath);
    if (!environmentFileStatus.isFile()) {
      throw new Error(
        "Local configuration must be a regular file, not a symlink or directory.",
      );
    }
    existingConfiguration = readFileSync(environmentFilePath, "utf8");
    environmentFileExists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (
    /^\s*(?:export\s+)?(?:POSTGRES_PASSWORD|APP_DB_PASSWORD)\s*=/m.test(
      existingConfiguration,
    )
  ) {
    throw new Error(
      "PostgreSQL credential entries already exist; left unchanged. Reuse them. Password rotation on an existing database must be done explicitly in PostgreSQL.",
    );
  }
  const generateRandomPassword = () => randomBytes(32).toString("hex");
  const newCredentials = `POSTGRES_PASSWORD=${generateRandomPassword()}\nAPP_DB_PASSWORD=${generateRandomPassword()}\n`;
  if (environmentFileExists) {
    chmodSync(environmentFilePath, 0o600);
    appendFileSync(
      environmentFilePath,
      `${existingConfiguration.endsWith("\n") || !existingConfiguration ? "" : "\n"}${newCredentials}`,
    );
  } else {
    writeFileSync(environmentFilePath, newCredentials, {
      flag: "wx",
      mode: 0o600,
    });
  }
  console.log(
    "Added private PostgreSQL credentials to the local environment file. Keep it out of version control and reuse it for this database.",
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
