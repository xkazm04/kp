import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

// KP_E2E_BASE_URL points the suite at an ALREADY-RUNNING app (e.g. a production
// build started with `npm run build && npm run start -- --port 3101`, or a
// remote deployment) instead of letting Playwright boot the dev server. When it
// is set, the webServer block is omitted entirely — Playwright neither spawns
// nor waits for anything; when unset, behavior is exactly the pre-override
// default (dev server on :3101, reused locally, fresh in CI). e2e/dev-auth.ts
// reads the same variable so the entry cookie lands on the right origin.
const overrideBaseUrl = process.env.KP_E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 30_000
  },
  use: {
    baseURL: overrideBaseUrl ?? "http://localhost:3101",
    trace: "retain-on-failure"
  },
  ...(overrideBaseUrl
    ? {}
    : {
        webServer: {
          command: "npm run dev -- --port 3101",
          url: "http://localhost:3101",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
