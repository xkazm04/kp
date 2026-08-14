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

  test("?sec= deep-links straight into a section, then clears itself", async ({ page }) => {
    await page.goto("/?tab=analytics&sec=quality");
    await expect(sectionNav(page).getByRole("radio", { name: /quality/i })).toHaveAttribute("aria-checked", "true");
    // The URL is an INBOX, not the state: both params are consumed on arrival and
    // cleared, so the address bar does not accumulate view state. A param left
    // behind would also break the next link to the same value — not a change,
    // so nothing would happen and the link would look dead.
    await expect(page).toHaveURL(/^[^?]*\/?$/);
  });

  test("a second link to the SAME section still works after the first", async ({ page }) => {
    // The regression the read-then-clear design exists to prevent.
    await page.goto("/?tab=analytics&sec=quality");
    await expect(sectionNav(page).getByRole("radio", { name: /quality/i })).toHaveAttribute("aria-checked", "true");
    await sectionNav(page).getByRole("radio", { name: /performance/i }).click();
    await expect(sectionNav(page).getByRole("radio", { name: /performance/i })).toHaveAttribute("aria-checked", "true");
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

  test("switching sections swaps the content and writes NOTHING to the URL", async ({ page }) => {
    await page.goto("/?tab=analytics");
    // Let the inbox finish consuming ?tab= before sampling the URL — the arrival
    // cleanup is itself a (one-time) rewrite, and capturing mid-flight would
    // compare against a URL the app is about to legitimately change.
    await expect(sectionNav(page)).toBeVisible();
    await expect(page).toHaveURL(/^[^?]*\/?$/);
    const before = page.url();

    await sectionNav(page).getByRole("radio", { name: /economics/i }).click();
    await expect(sectionNav(page).getByRole("radio", { name: /economics/i })).toHaveAttribute("aria-checked", "true");
    // The section is app state now; clicking around must not touch the query.
    expect(page.url()).toBe(before);
    // Performance's brief must be GONE — a switcher that only adds content would
    // leave the tab exactly as long as it was before the split.
    await expect(page.getByText(/candidates in play/i)).toHaveCount(0);

    await sectionNav(page).getByRole("radio", { name: /quality/i }).click();
    await expect(sectionNav(page).getByRole("radio", { name: /quality/i })).toHaveAttribute("aria-checked", "true");
    expect(page.url()).toBe(before);
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
