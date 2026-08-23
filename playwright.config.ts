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
  // A committed `test.only` runs that ONE test, marks every sibling skipped, and
  // exits 0 — so the keyless CI job would print green while the role-to-schedule
  // journey, the modal dismissal contract and the profile-builder round-trip never
  // ran. Latent rather than active (the tree is clean today), but it is the exact
  // shape of silent-green this repo's guards keep being caught by. CI-only, so a
  // local `.only` while iterating still works.
  forbidOnly: !!process.env.CI,
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
          timeout: 120_000,
          // Playwright already merges this over process.env, so these three are
          // inherited anyway. They are named here so the config SAYS which server
          // env the suite depends on (e2e/app-master-hire.spec.ts's header is the
          // long version), and so a future `env:` that stops inheriting can't
          // silently drop them:
          //   KP_OFFLINE               forces the keyless/deterministic path
          //   KP_APP_MASTER_REPO_ROOTS opens the local-path repo-scan allow-list
          //   KP_SECRET                the at-rest key the Personas pk_ is stored under
          // Only forwarded WHEN SET: an unset one must not arrive as "" (an empty
          // KP_OFFLINE would be a truthiness trap waiting to happen).
          env: {
            ...(process.env.KP_OFFLINE ? { KP_OFFLINE: process.env.KP_OFFLINE } : {}),
            ...(process.env.KP_APP_MASTER_REPO_ROOTS
              ? { KP_APP_MASTER_REPO_ROOTS: process.env.KP_APP_MASTER_REPO_ROOTS }
              : {}),
            ...(process.env.KP_SECRET ? { KP_SECRET: process.env.KP_SECRET } : {})
          }
        }
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
