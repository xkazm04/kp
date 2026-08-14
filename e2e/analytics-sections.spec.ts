// Analytics section split — the three sections behind the ?sec= switcher, and
// the Performance variant switcher the prototype round is being reviewed on.
//
// Deterministic and keyless: /api/analytics reads the SQLite pipeline tables and
// never spawns an LLM, so this runs in the same subset as modal-escape /
// journey-role-to-schedule. What it pins is exactly what curl could not reach —
// the tab is a client component behind next/dynamic, so a 200 from the server
// says nothing about whether the section actually rendered.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

/** The section switcher is a radiogroup (shared SegmentedControl). */
const sectionNav = (page: Page) => page.getByRole("radiogroup", { name: /analytics section/i });

test.describe("Analytics — three sections behind the switcher", () => {
  test("the switcher renders all three sections and Performance is the default", async ({ page }) => {
    await page.goto("/?tab=analytics");

    const nav = sectionNav(page);
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("radio")).toHaveCount(3);

    // Default landing section — a bare ?tab=analytics must resolve to one.
    await expect(nav.getByRole("radio", { name: /performance/i })).toHaveAttribute("aria-checked", "true");
    // Its content, not just its tab: the funnel card is Performance's centrepiece.
    await expect(page.getByRole("heading", { name: /funnel/i }).first()).toBeVisible();
  });

  test("?sec= deep-links straight into a section", async ({ page }) => {
    await page.goto("/?tab=analytics&sec=quality");
    await expect(sectionNav(page).getByRole("radio", { name: /quality/i })).toHaveAttribute("aria-checked", "true");
  });

  test("an unknown ?sec= falls back to the default instead of blanking", async ({ page }) => {
    // The exact failure the runtime guard exists to prevent: a stale or
    // hand-edited link resolving to a section that does not exist.
    await page.goto("/?tab=analytics&sec=not-a-section");
    await expect(sectionNav(page).getByRole("radio", { name: /performance/i })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { name: /funnel/i }).first()).toBeVisible();
  });

  test("switching sections swaps the content and writes back to the URL", async ({ page }) => {
    await page.goto("/?tab=analytics");

    await sectionNav(page).getByRole("radio", { name: /economics/i }).click();
    await expect(page).toHaveURL(/sec=economics/);
    await expect(sectionNav(page).getByRole("radio", { name: /economics/i })).toHaveAttribute("aria-checked", "true");
    // Performance's funnel must be GONE — a switcher that only adds content
    // would leave the tab exactly as long as it was before the split.
    await expect(page.getByRole("heading", { name: /^funnel$/i })).toHaveCount(0);

    await sectionNav(page).getByRole("radio", { name: /quality/i }).click();
    await expect(page).toHaveURL(/sec=quality/);
  });
});

test.describe("Analytics — Performance prototype variants", () => {
  // Every variant renders the same payload through a different mental model;
  // the check is that each one mounts and paints real content, since a variant
  // that throws would otherwise only be caught by opening it by hand.
  for (const variant of ["Flight deck", "Briefing", "Scoreboard"] as const) {
    test(`the ${variant} variant renders`, async ({ page }) => {
      await page.goto("/?tab=analytics");
      await page.getByRole("button", { name: variant, exact: true }).click();
      await expect(page.getByRole("button", { name: variant, exact: true })).toHaveAttribute("aria-pressed", "true");
      // Something real painted — not an error boundary, not an empty div.
      await expect(page.locator("section[aria-busy]")).toBeVisible();
      await expect(page.getByRole("heading").first()).toBeVisible();
    });
  }

  test("the Scoreboard's role table sorts, and marks the sorted column for AT", async ({ page }) => {
    await page.goto("/?tab=analytics");
    await page.getByRole("button", { name: "Scoreboard", exact: true }).click();

    // The scoreboard opens already ranked by hire rate: a league table that
    // arrives unsorted has not made its argument.
    const hireRateHeader = page.getByRole("columnheader", { name: /hire rate/i });
    await expect(hireRateHeader).toHaveAttribute("aria-sort", "descending");

    // Sorting another column moves the aria-sort with it — the state the two
    // hand-rolled sort headers in this repo never exposed at all.
    const pipelineHeader = page.getByRole("columnheader", { name: /in pipeline/i });
    await pipelineHeader.getByRole("button").click();
    await expect(pipelineHeader).toHaveAttribute("aria-sort", /ascending|descending/);
    await expect(hireRateHeader).toHaveAttribute("aria-sort", "none");
  });
});
