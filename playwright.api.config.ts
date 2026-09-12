import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/api-e2e",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:3015",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm start -- --port 3015",
    url: "http://localhost:3015",
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-api", open: "never" }],
  ],
});
