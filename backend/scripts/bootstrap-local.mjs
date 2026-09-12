import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (
  process.env.NODE_ENV === "production" ||
  !new URL(process.env.DATABASE_URL).pathname.endsWith("_dev")
)
  throw Error("Local development database only");
if (existsSync(".runtime/admin-access.txt"))
  throw Error("Local access file already exists; no credentials changed");
const secret = randomBytes(24).toString("base64url");
const result = spawnSync(
  process.execPath,
  ["backend/dist/cli.js", "bootstrap"],
  { input: secret, encoding: "utf8", windowsHide: true },
);
if (result.status !== 0)
  throw Error(
    "Bootstrap refused; inspect database setup without resetting existing accounts",
  );
writeFileSync(
  ".runtime/admin-access.txt",
  `Local system: http://localhost:3000/login\nUsername: admin\nPassword: ${secret}\n\nPrivate local handoff. Change this password in Profile and remove this file after recording it securely.\n`,
  { mode: 0o600 },
);
console.log(
  "Local administrator created. Credentials are in .runtime/admin-access.txt (ignored by Git).",
);
