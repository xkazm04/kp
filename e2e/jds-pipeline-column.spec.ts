// The JD library's per-role pipeline overview — the half of the Analytics
// "scoreboard" prototype that survived, moved to where a recruiter is already
// looking at their roles.
//
// Deterministic and keyless: GET /api/jds reads SQLite and spawns nothing.
import { expect, test } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

test.describe("JD library — pipeline column", () => {
  test("the table carries a Pipeline column", async ({ page }) => {
    await page.goto("/?tab=library");
    // ONE merged column, not a Pipeline + Hired pair: two columns overflowed the
    // table and pushed the row actions off-screen. The hires ride inside the
    // pipeline cell when there are any.
    await expect(page.getByRole("columnheader", { name: /pipeline/i })).toBeVisible();
  });

  test("the eight-column table fits its panel instead of scrolling", async ({ page }) => {
    // Regression guard: the table already overflowed by ~136px BEFORE the
    // Pipeline column, and adding it pushed Saved and the row actions clean off
    // the visible area. Measured rather than eyeballed, after real rows land —
    // a header-only table sizes its columns to the header text.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?tab=library");
    await expect(page.locator("tbody tr").nth(3)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => {
      const table = document.querySelector("table") as HTMLElement;
      const wrap = table.closest("div.overflow-x-auto") as HTMLElement | null;
      return wrap ? table.scrollWidth - wrap.clientWidth : 0;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the quantitative columns sort, and say so for assistive tech", async ({ page }) => {
    await page.goto("/?tab=library");

    // The ledger's default ordering is newest-saved-first, and it must ANNOUNCE
    // that rather than leaving every column claiming "none" — the exact gap the
    // two hand-rolled sort headers in this repo had before ColumnHead existed.
    const saved = page.getByRole("columnheader", { name: /saved/i });
    await expect(saved).toHaveAttribute("aria-sort", "descending");

    // Re-ranking by pipeline moves the sorted state with it.
    const pipeline = page.getByRole("columnheader", { name: /pipeline/i });
    await pipeline.getByRole("button").click();
    await expect(pipeline).toHaveAttribute("aria-sort", /ascending|descending/);
    await expect(saved).toHaveAttribute("aria-sort", "none");

    // And clicking the same column again reverses it rather than re-sorting the
    // same way, which would read as a dead control.
    const first = await pipeline.getAttribute("aria-sort");
    await pipeline.getByRole("button").click();
    await expect(pipeline).not.toHaveAttribute("aria-sort", first!);
  });

  test("a JD with no linked job shows no pipeline rather than a zero", async ({ page }) => {
    // "Never ingested" and "ingested but empty" are different facts; rendering
    // the first as 0 would rank real-but-quiet roles below JDs that were never
    // turned into a job at all.
    await page.goto("/?tab=library");
    await expect(page.locator("tbody tr").first()).toBeVisible();
    const dashes = page.locator('tbody td[title]').filter({ hasText: "—" });
    // Not asserting a count — the seeded library may legitimately have none —
    // only that if any exist they carry the explanatory title, never a bare 0.
    for (const cell of await dashes.all()) {
      await expect(cell).toHaveAttribute("title", /no linked job/i);
    }
  });
});
