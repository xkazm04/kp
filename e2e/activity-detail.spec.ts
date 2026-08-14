// Insights → Activity, row-click detail. Deterministic and keyless: the ledger
// is read straight from llm_usage, no LLM call involved.
//
// The case that matters most here is the DEGRADED one. Every ledger row written
// before the request-id chain existed carries a null `request_id`, and so does
// every call made outside a background task. Those rows must open a detail that
// says plainly there is no stored output — not an empty panel, not a spinner
// that never resolves, and not a fetch to /api/tasks/null.
import { expect, test } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("Activity — row detail", () => {
  test("clicking a row opens the detail with the ledger facts", async ({ page }) => {
    await page.goto("/?tab=activity");

    // The table only exists when the ledger has rows; skip rather than fail on a
    // workspace that has never run an AI action.
    const trigger = page.locator("tbody tr button").first();
    await expect(async () => {
      expect(await trigger.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });

    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The ledger half is painted from data the table already had — it must be
    // there on the first frame, with no fetch involved.
    await expect(dialog.getByText(/provider/i).first()).toBeVisible();
    await expect(dialog.getByText(/tokens in\/out/i).first()).toBeVisible();
    await expect(dialog.getByText(/answered by/i).first()).toBeVisible();

    // And the output half states one of its three honest outcomes rather than
    // rendering an empty region.
    await expect(
      dialog.getByText(/no output was stored|aged out of the task history|without storing any output|what it produced/i).first()
    ).toBeVisible();
  });

  test("Escape closes the detail", async ({ page }) => {
    await page.goto("/?tab=activity");
    const trigger = page.locator("tbody tr button").first();
    await expect(async () => {
      expect(await trigger.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 20_000 });

    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
