// Generate machine-local development credentials, never image/committed defaults.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

try {
  const password = () => randomBytes(32).toString("hex");
  writeFileSync(
    process.env.DATABASE_ENV_FILE || ".env.postgres",
    `POSTGRES_PASSWORD=${password()}\nAPP_DB_PASSWORD=${password()}\n`,
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
