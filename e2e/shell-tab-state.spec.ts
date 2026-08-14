// The workspace tab is APP STATE; `?tab=` is an inbox for arrivals only.
//
// What this pins is the contract that replaced "the URL IS the state": a deep
// link still lands, the param is consumed on receipt, and clicking around the
// sidebar writes nothing. The second-link case is the one a naive "read it once"
// implementation gets wrong — leave the param in the bar and a repeat link to the
// same tab is not a change, so nothing happens and the link looks broken.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

/** The URL with no query at all — what the inbox leaves behind. */
const CLEAN = /^[^?]*\/?$/;

const railButton = (page: Page, name: RegExp) => page.getByRole("button", { name }).first();

test.describe("Workspace tab — state, not URL", () => {
  test("a ?tab= deep link lands, then the param is cleared", async ({ page }) => {
    await page.goto("/?tab=analytics");
    await expect(page.getByRole("heading", { name: /pipeline analytics/i })).toBeVisible();
    await expect(page).toHaveURL(CLEAN);
  });

  test("a repeat link to the same tab still works", async ({ page }) => {
    await page.goto("/?tab=analytics");
    await expect(page.getByRole("heading", { name: /pipeline analytics/i })).toBeVisible();
    await expect(page).toHaveURL(CLEAN);

    // Leave, then arrive at the SAME tab again. With a stale param left in the
    // bar this second arrival would be a no-op.
    await page.goto("/?tab=library");
    await expect(page.getByRole("heading", { name: /job description library/i })).toBeVisible();

    await page.goto("/?tab=analytics");
    await expect(page.getByRole("heading", { name: /pipeline analytics/i })).toBeVisible();
    await expect(page).toHaveURL(CLEAN);
  });

  test("switching tabs from the rail writes nothing to the URL", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(CLEAN);
    const before = page.url();

    await railButton(page, /insights/i).click();
    await railButton(page, /library/i).click();
    await expect(page).toHaveURL(CLEAN);
    expect(page.url()).toBe(before);
  });

  test("an unknown ?tab= leaves the current view alone", async ({ page }) => {
    // Rejected rather than adopted-then-corrected: bouncing the reader to the
    // default would hide that the link was bad.
    await page.goto("/?tab=not-a-tab");
    await expect(page).toHaveURL(CLEAN);
    await expect(page.locator("main")).toBeVisible();
  });
});
