import "dotenv/config";
import { spawnSync } from "node:child_process";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Set TEST_DATABASE_URL to isolated *_test database");
const env = {
  ...process.env,
  DATABASE_URL: url,
  MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL || url,
  NODE_ENV: "test",
};
for (const args of [
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  ["backend/dist/cli.js", "seed-test"],
]) {
  const r = spawnSync(process.execPath, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
