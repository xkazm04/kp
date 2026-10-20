// The job-seeker flow under /me ("The Sieve"), keyless and deterministic.
//
// DECLARED, NOT YET ENROLLED. This spec is written against the managed webServer's
// throwaway DB (playwright.config.ts: data/kp-e2e.sqlite) and needs no key: a fresh
// install paints the flow's EMPTY states, which is exactly the contract worth pinning —
// the flow opens on the Arrive drop, the sieve says "not reached" before a CV, the old
// /me/jobs address lands on the flow, the Sources step renders its three lanes with tier C
// carrying no control, a tier-B lock opens the acknowledgement with the CTA disabled until
// ticked, and the scans page keeps the timer locked until a scan has succeeded. It is NOT
// in KEYLESS_SPECS: enrolling a spec there means mirroring it in ci.yml's "Run
// deterministic specs" step and in .claude/CLAUDE.md in the same change
// (keyless-e2e-pin.test.mjs pins all three). Run it by hand:
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test jobseeker-keyless
import { expect, test } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("/me keyless", () => {
  test("the flow opens on the Arrive drop, and the sieve is not reached before a CV", async ({ page }) => {
    await page.goto("/me");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/drop your cv here/i)).toBeVisible();
    await expect(page.locator("nav.rail li")).toHaveCount(8);
    await expect(page.locator("#s-sieve")).toContainText(/not reached/i);
    await expect(page.getByRole("button", { name: /scan now/i })).toHaveCount(0);
  });

  test("the old feed address lands on the flow", async ({ page }) => {
    await page.goto("/me/jobs");
    await expect(page).toHaveURL(/\/me(#s-evening)?$/);
    await expect(page.locator("#s-evening")).toBeVisible();
  });

  test("sources render three lanes; tier C carries no control", async ({ page }) => {
    await page.goto("/me#s-sources");
    for (const tier of ["A", "B", "C"]) {
      await expect(page.locator(`section[data-tier="${tier}"]`)).toBeVisible();
    }
    const tierC = page.locator('section[data-tier="C"]');
    await expect(tierC.locator("[data-refused]").first()).toBeVisible();
    await expect(tierC.getByRole("switch")).toHaveCount(0);
    await expect(tierC.getByRole("button")).toHaveCount(0);
  });

  test("a tier B lock opens the acknowledgement, CTA disabled until ticked", async ({ page }) => {
    // Source controls wait for a CV: give the throwaway DB a profile through the real door.
    const put = await page.request.put("/api/jobseeker/profile", { data: { profile: { displayName: "E2E Seeker" } } });
    expect(put.ok()).toBeTruthy();
    await page.goto("/me#s-sources");
    const tierB = page.locator('section[data-tier="B"]');
    await tierB.getByRole("button", { name: /read terms/i }).first().click();
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
    await expect(ack).toBeHidden();
    await expect(tierB.getByRole("switch")).toHaveCount(0);
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
