// Fake docker CLI for preflight tests: answers read-only queries from FIXTURE,
// logs every call to LOG, and runs exec'd scripts against TEST_HOME.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
fs.appendFileSync(process.env.LOG, `${JSON.stringify(args)}\n`);

if (args[0] === "exec" && args[1] === "-i") {
  const script = fs.readFileSync(0, "utf8").replaceAll("/home/node", process.env.TEST_HOME);
  const result = spawnSync("sh", ["-s"], { input: script, stdio: ["pipe", "inherit", "inherit"] });
  process.exit(result.status ?? 1);
}
let output;
switch (args.slice(0, 2).join(" ")) {
  case "compose config": output = fixture.config; break;
  case "image inspect": output = fixture.image; break;
  case "container ls": output = (args.includes("--filter") ? fixture.owned : fixture.names).join("\n"); break;
  case "container inspect": output = fixture.existing; break;
  case "ps --filter": output = (fixture.users[args[2]] || []).join("\n"); break;
  default: throw new Error(`Unexpected Docker command: ${args.join(" ")}`);
}
console.log(typeof output === "string" ? output : JSON.stringify(output));
