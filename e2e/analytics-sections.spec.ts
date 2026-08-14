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
    // Its content, not just its tab. The Briefing baseline leads with a computed
    // lede rather than a chart title, so that is the stable marker.
    await expect(page.getByText(/candidates in play/i).first()).toBeVisible();
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
    await expect(page.getByText(/candidates in play/i).first()).toBeVisible();
  });

  test("switching sections swaps the content and writes back to the URL", async ({ page }) => {
    await page.goto("/?tab=analytics");

    await sectionNav(page).getByRole("radio", { name: /economics/i }).click();
    await expect(page).toHaveURL(/sec=economics/);
    await expect(sectionNav(page).getByRole("radio", { name: /economics/i })).toHaveAttribute("aria-checked", "true");
    // Performance's brief must be GONE — a switcher that only adds content would
    // leave the tab exactly as long as it was before the split.
    await expect(page.getByText(/candidates in play/i)).toHaveCount(0);

    await sectionNav(page).getByRole("radio", { name: /quality/i }).click();
    await expect(page).toHaveURL(/sec=quality/);
  });
});

test.describe("Analytics — Performance reads as a brief", () => {
  // The prototype round closed on the Briefing direction. What distinguishes it
  // from the grid it replaced is that each band opens with a CLAIM derived from
  // the data rather than a chart title, so that is what this checks — a
  // regression to generic panel headings would pass a "does it render" test.
  test("the section leads with a computed claim, not a chart title", async ({ page }) => {
    await page.goto("/?tab=analytics");
    await expect(page.getByText(/candidates in play/i).first()).toBeVisible();
    // The funnel band's claim states a stage or a verdict, never just "Funnel".
    await expect(
      page.getByRole("heading", { name: /stalling at|weakest link|clearing its goal|come through the funnel/i }).first()
    ).toBeVisible();
  });
});
