import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || "chromium",
  },
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_COMMAND || "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.PLAYWRIGHT_WEB_COMMAND,
    timeout: 120000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
