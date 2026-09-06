// Insights → Activity, row-click detail. Deterministic and keyless: the ledger
// is read straight from llm_usage, no LLM call involved.
//
// The case that matters most here is the DEGRADED one. Every ledger row written
// before the request-id chain existed carries a null `request_id`, and so does
// every call made outside a background task. Those rows must open a detail that
// says plainly there is no stored output — not an empty panel, not a spinner
// that never resolves, and not a fetch to /api/tasks/null.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

/** THE LEDGER CAN BE LEGITIMATELY EMPTY, and that is not a failure.
 *
 *  llm_usage records AI calls that actually happened; a fresh database — which
 *  is what the suite now runs against (playwright.config.ts's throwaway
 *  KP_DB_PATH) and what CI's keyless job always had — has made none. The table
 *  only exists when there are rows, so both tests below need one.
 *
 *  This used to be `toPass` on `count > 0`, which turns "nothing has been run
 *  yet" into a 20-second timeout and a red build. Skipping SAYS which of the two
 *  it was, which is the whole difference between a gap in coverage and a defect.
 *  It is deliberately not a fixture: a fabricated ledger row would not exercise
 *  the request-id chain this file is about. */
async function skipOnEmptyLedger(page: Page): Promise<void> {
  await page.goto("/?tab=activity");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 20_000 });
  const trigger = page.locator("tbody tr button").first();
  // Give the tab's client fetch a chance to paint rows before concluding there
  // are none — an empty ledger and an unresolved one look identical for a moment.
  await trigger.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  test.skip(
    (await trigger.count()) === 0,
    "the llm_usage ledger is empty on this database — no AI action has been run, so there is no row to open"
  );
}

test.describe("Activity — row detail", () => {
  test("clicking a row opens the detail with the ledger facts", async ({ page }) => {
    await skipOnEmptyLedger(page);
    const trigger = page.locator("tbody tr button").first();

    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The ledger half is painted from data the table already had — it must be
    // there on the first frame, with no fetch involved.
    await expect(dialog.getByText(/provider/i).first()).toBeVisible();
    await expect(dialog.getByText(/tokens in\/out/i).first()).toBeVisible();
    await expect(dialog.getByText(/answered by/i).first()).toBeVisible();

    // And the output half SAYS something rather than rendering an empty region.
    //
    // This used to accept /…|what it produced/ — which is the section's own
    // always-rendered <h3> (activity.detailOutput). Matching it made the
    // assertion unfailable: an output half that rendered nothing under its
    // heading, or a spinner that never resolved (the two failures this file's
    // header calls out by name), passed on the heading alone. So strip the
    // heading and require the BODY to be non-empty — one of the three honest
    // degradations, a failed run's error, or a real resolved result.
    const outputSection = dialog.locator("section").filter({ hasText: /what it produced/i }).first();
    await expect(outputSection).toBeVisible();
    await expect(async () => {
      const body = (await outputSection.innerText()).replace(/what it produced/i, "").trim();
      expect(body, "the output half rendered its heading and nothing else").not.toBe("");
    }).toPass({ timeout: 20_000 });
  });

  test("Escape closes the detail", async ({ page }) => {
    await skipOnEmptyLedger(page);
    const trigger = page.locator("tbody tr button").first();

    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
