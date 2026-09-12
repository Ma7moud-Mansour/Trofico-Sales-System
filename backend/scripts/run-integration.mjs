import "dotenv/config";
import { spawn } from "node:child_process";
import { once } from "node:events";
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith("_test"))
  throw Error("Set an isolated TEST_DATABASE_URL ending _test");
const port = "4071";
const child = spawn(process.execPath, ["backend/dist/main.js"], {
  stdio: ["ignore", "ignore", "inherit"],
  windowsHide: true,
  env: { ...process.env, DATABASE_URL: url, PORT: port, NODE_ENV: "test" },
});
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("Test API failed to start");
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/v1/health/live`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw Error("Test API startup timeout");
  const tests = spawn(
    process.execPath,
    ["--test", "--test-concurrency=1", "backend/tests/integration.mjs"],
    {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, TEST_API_URL: `http://127.0.0.1:${port}/api/v1` },
    },
  );
  const [code] = await once(tests, "exit");
  process.exitCode = code || 0;
} finally {
  if (child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
}
