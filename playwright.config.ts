import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 30_000
  },
  use: {
    baseURL: "http://localhost:3101",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev -- --port 3101",
    url: "http://localhost:3101",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
