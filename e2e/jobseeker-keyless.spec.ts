// The job-seeker surfaces under /me, keyless and deterministic (WP5).
//
// DECLARED, NOT YET ENROLLED. This spec is written against the managed webServer's
// throwaway DB (playwright.config.ts: data/kp-e2e.sqlite) and needs no key: every
// page it visits paints its EMPTY state from a fresh install, which is exactly the
// contract worth pinning: the chain-aware feed says "start with your CV", the sources
// page renders its three tiers with tier C carrying no control, and the scans page
// keeps the timer locked until a scan has succeeded. It is NOT in KEYLESS_SPECS:
// enrolling a spec there means mirroring it in ci.yml's "Run deterministic specs"
// step and in .claude/CLAUDE.md in the same change (keyless-e2e-pin.test.mjs pins
// all three), and the workflow file is outside this work package. Run it by hand:
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test jobseeker-keyless
import { expect, test } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("/me keyless", () => {
  test("profile page opens on the import step", async ({ page }) => {
    await page.goto("/me");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // No profile on a fresh DB: the import drop zone is the page.
    await expect(page.getByText(/import your cv/i).first()).toBeVisible();
  });

  test("jobs feed shows the first missing link of the chain", async ({ page }) => {
    await page.goto("/me/jobs");
    // No profile → the empty state points at /me, never at "scan now".
    const empty = page.locator("[data-empty-state]");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveAttribute("data-empty-state", "no_profile");
    await expect(empty.getByRole("link", { name: /profile/i })).toHaveAttribute("href", "/me");
    await expect(page.getByRole("button", { name: /scan now/i })).toHaveCount(0);
  });

  test("sources render three tiers; tier C carries no control", async ({ page }) => {
    await page.goto("/me/sources");
    for (const tier of ["A", "B", "C"]) {
      await expect(page.locator(`section[data-tier="${tier}"]`)).toBeVisible();
    }
    const tierC = page.locator('section[data-tier="C"]');
    const refused = tierC.locator("[data-refused]");
    await expect(refused.first()).toBeVisible();
    // The ROWS carry no control. The section heading owns one text-free explain
    // hint (an IconAction, round 27), which is not a control on any source.
    await expect(refused.getByRole("switch")).toHaveCount(0);
    await expect(refused.getByRole("button")).toHaveCount(0);
    await expect(tierC.getByRole("switch")).toHaveCount(0);
  });

  test("a tier B board's toggle opens the acknowledgement, CTA disabled until ticked", async ({ page }) => {
    await page.goto("/me/sources");
    const tierB = page.locator('section[data-tier="B"]');
    // Add the first catalogued tier B board, then try to enable it.
    await tierB.getByRole("button", { name: /^add /i }).first().click();
    const toggle = tierB.getByRole("switch").first();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    const ack = page.locator('[data-testid="source-ack"]');
    await expect(ack).toBeVisible();
    // The checkbox is first in focus order; the CTA is disabled until it is ticked.
    await expect(ack.getByRole("checkbox")).toBeFocused();
    const cta = ack.getByRole("button", { name: /enable source/i });
    await expect(cta).toBeDisabled();
    await ack.getByRole("checkbox").check();
    await expect(cta).toBeEnabled();
    // Not confirmed here: the suite must not switch a crawler on, even against a throwaway DB.
    await ack.getByRole("button", { name: /not now/i }).click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("scans page keeps the timer locked until a scan succeeded", async ({ page }) => {
    await page.goto("/me/scans");
    const toggle = page.locator('[data-testid="scan-clock-toggle"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("button", { name: /scan now/i })).toBeVisible();
  });
});
