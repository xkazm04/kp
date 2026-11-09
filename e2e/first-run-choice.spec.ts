// The first-run data choice (operator triage T1), end to end on a database that is
// DELETED before each server start — the one place the suite runs unseeded.
//
// Run it as `npx playwright test e2e/first-run-choice.spec.ts` (playwright.config.ts
// then drops the managed seeded webServer: two dev servers cannot share a checkout).
// Each test owns a fresh server process on :3102 over data/kp-first-run.sqlite
// (gitignored); see e2e/fixtures/fresh-server.ts. Not in KEYLESS_SPECS.
import { expect, test } from "@playwright/test";
import { FRESH_ORIGIN, startFreshServer, type FreshServer } from "./fixtures/fresh-server";

test.describe.configure({ mode: "serial" });
test.use({ baseURL: FRESH_ORIGIN });

let server: FreshServer | undefined;
test.beforeEach(async ({ context }) => {
  server = await startFreshServer();
  // '/' is gated server-side: enter the workspace the way open mode does.
  await context.addCookies([{ name: "kp_entered", value: "1", url: FRESH_ORIGIN }]);
});
test.afterEach(async () => {
  await server?.stop();
  server = undefined;
});

test("a fresh database asks, and 'explore with demo' lands on a populated board", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByTestId("first-run-data-choice")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByTestId("first-run-explore-demo").click();
  await expect(page).toHaveURL(/\/\?tab=pipeline/);
  await expect(page.getByTestId("first-run-data-choice")).toHaveCount(0);

  // Populated: the seed ran, so the board API answers with entries.
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/pipeline");
      return res.ok() ? ((await res.json()) as { entries: unknown[] }).entries.length : 0;
    })
    .toBeGreaterThan(0);
  const first = await page.request.get("/api/setup/first-run");
  expect((await first.json()).pending).toBe(false);
});

test("on a second fresh database 'start empty' reaches the wizard and is never asked again", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByTestId("first-run-data-choice")).toBeVisible();

  await page.getByTestId("first-run-start-empty").click();
  await expect(page.getByTestId("first-run-data-choice")).toHaveCount(0);
  // The setup wizard takes over the empty workspace as a modal overlay.
  await expect(page.getByRole("dialog", { name: "Set up your workspace" })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("first-run-data-choice")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Set up your workspace" })).toBeVisible();
  expect((await (await page.request.get("/api/setup/first-run")).json()).pending).toBe(false);
});
