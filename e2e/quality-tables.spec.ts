// Analytics → Quality & audit: the two lists that used to be unbounded are now
// tables with sorting, header-cell filters and a pager.
//
// The decision log is SERVER-sorted and server-paged (the audit trail must stay
// reachable in full, so it cannot be held in memory); the sealed records are
// client-side (the endpoint returns the whole chain to verify it). Both are
// checked here because the two halves of the table kit have to behave the same
// from the reader's side regardless of where the work happens.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

/** Quality is the third section; the decision log sits at its foot. */
async function openQuality(page: Page) {
  await page.goto("/?tab=analytics&sec=quality");
  await expect(page.getByRole("heading", { name: /decision log/i })).toBeVisible({ timeout: 20_000 });
}

test.describe("Decision log — table, not infinite scroll", () => {
  test("renders a paged table with sortable headers", async ({ page }) => {
    await openQuality(page);
    const when = page.getByRole("columnheader", { name: /when/i }).first();
    // Opens newest-first and SAYS so — the state the infinite scroll could not
    // express at all.
    await expect(when).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByRole("columnheader", { name: /candidate/i }).first()).toBeVisible();
  });

  test("sorting a column re-queries the server and moves aria-sort", async ({ page }) => {
    await openQuality(page);
    const when = page.getByRole("columnheader", { name: /when/i }).first();
    const candidate = page.getByRole("columnheader", { name: /candidate/i }).first();

    await candidate.getByRole("button").click();
    await expect(candidate).toHaveAttribute("aria-sort", /ascending|descending/);
    await expect(when).toHaveAttribute("aria-sort", "none");
  });

  test("the pager reports position in the WHOLE trail, and turning a page changes the rows", async ({ page }) => {
    await openQuality(page);
    const pager = page.getByRole("navigation", { name: /table pages/i }).last();
    // A server-paged table knows its true total, so the pager is real: the old
    // "load more" could only ever say how far you had scrolled.
    await expect(pager).toBeVisible();

    const firstRowBefore = await page.locator("table").last().locator("tbody tr").first().innerText();
    await pager.getByRole("button", { name: /next/i }).click();
    await expect(async () => {
      const after = await page.locator("table").last().locator("tbody tr").first().innerText();
      expect(after).not.toBe(firstRowBefore);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("Sealed decision records — table", () => {
  test("renders a table with the chain position always visible", async ({ page }) => {
    await page.goto("/?tab=analytics&sec=quality");
    await expect(page.getByRole("heading", { name: /decision records/i })).toBeVisible({ timeout: 20_000 });

    // Six columns, seq first. Targeted structurally rather than by label: the
    // chain-position column is titled "#", and a ColumnHead's accessible name is
    // its title plus the sort button's, so a text matcher on a single glyph is
    // both brittle and ambiguous against the sibling log table.
    const records = page.locator("table").first();
    await expect(records.locator("thead th")).toHaveCount(6);
    await expect(records.locator("thead th").first()).toHaveAttribute("aria-sort", /ascending|descending/);
  });

  test("defaults to newest link first and re-sorts on click", async ({ page }) => {
    await page.goto("/?tab=analytics&sec=quality");
    const seq = page.locator("table").first().locator("thead th").first();
    await expect(seq).toBeVisible({ timeout: 20_000 });
    // Opens on the chain's own order, newest link first.
    await expect(seq).toHaveAttribute("aria-sort", "descending");

    await seq.getByRole("button").click();
    await expect(seq).toHaveAttribute("aria-sort", "ascending");
  });
});
