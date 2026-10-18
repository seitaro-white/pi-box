// Generate machine-local development credentials, never image/committed defaults.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

try {
  const generateRandomPassword = () => randomBytes(32).toString("hex");
  writeFileSync(
    process.env.POSTGRES_CREDENTIALS_FILE || ".env.postgres",
    `POSTGRES_PASSWORD=${generateRandomPassword()}\nAPP_DB_PASSWORD=${generateRandomPassword()}\n`,
    { flag: "wx", mode: 0o600 }, // Never overwrite credentials or follow symlinks.
  );
  console.log(
    "Created private PostgreSQL credentials. Keep the file out of version control and reuse it for this database.",
  );
} catch (error) {
  console.error(
    error.code === "EEXIST"
      ? "Credentials file already exists; left unchanged. Reuse it. Password rotation on an existing database must be done explicitly in PostgreSQL."
      : error.message,
  );
  process.exitCode = 1;
}
