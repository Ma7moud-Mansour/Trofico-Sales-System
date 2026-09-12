import "dotenv/config";
import { spawn } from "node:child_process";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Isolated test database required");
const child = spawn(process.execPath, ["backend/dist/main.js"], {
  stdio: "inherit",
  windowsHide: true,
  env: {
    ...process.env,
    DATABASE_URL: url,
    NODE_ENV: "test",
    PORT: process.env.TEST_API_PORT || "4001",
  },
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
child.on("exit", (code) => process.exit(code || 0));
