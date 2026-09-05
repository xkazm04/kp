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
    // This used to be `waitForTimeout(800)` — the suite's only hard sleep, and
    // the wrong instrument twice over: 800ms is a guess that is simultaneously
    // too long on a warm run and too short on a cold compile. What the
    // measurement actually needs is (a) the display face loaded, because a
    // fallback-metric reflow changes every column width, and (b) a width that
    // has stopped moving. Both are observable, so observe them.
    await page.evaluate(() => document.fonts.ready);
    const measureOverflow = () =>
      page.evaluate(() => {
        const table = document.querySelector("table") as HTMLElement;
        const wrap = table.closest("div.overflow-x-auto") as HTMLElement | null;
        return wrap ? table.scrollWidth - wrap.clientWidth : 0;
      });
    // Polled rather than sampled once: a layout still settling reports a
    // transient overflow, and failing on that is the flake this replaces.
    await expect.poll(measureOverflow, { timeout: 15_000 }).toBeLessThanOrEqual(0);
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
    // Bind on the TOOLTIP, not on the dash. The old selector was `tbody td[title]`
    // filtered to "—", but no <td> in JdsLedgerRow carries a title — the tooltip
    // lives on the span INSIDE the pipeline cell — so it matched nothing, the loop
    // body never ran, and this test asserted nothing at all about the column.
    // Locating by the tooltip first means a cell that regressed to rendering "0"
    // is still found, and then fails on its text.
    const unlinked = page.locator('tbody td span[title^="No linked job"]');
    const count = await unlinked.count();
    // Still not asserting a count — the seeded library may legitimately have no
    // analysis-only JD — but every cell that IS one must read as a dash. A "0"
    // here would rank a never-ingested JD alongside a live-but-empty role.
    for (let i = 0; i < count; i += 1) {
      await expect(unlinked.nth(i)).toHaveText("—");
    }
  });
});
