// The OTHER public surfaces — everything `app/sitemap.ts` asks a crawler to
// index that is not '/'.
//
// e2e/landing.spec.ts audits the landing band by band, and token-doors-axe
// covers the candidate `[token]` doors. Between them sat five indexed pages
// with no e2e coverage at all: /about, /trust, /privacy, /terms and /market.
// /about in particular is a front door — the sitemap lists it, the landing's
// phone menu links to it — yet it shipped without the legal row every other
// front door carries and without any phone navigation.
//
// Fully deterministic and keyless: none of these five renders model output.
// /market reads the committed Czech market atlas, the rest are static copy.
// Part of the keyless CI subset — see .claude/CLAUDE.md and ci.yml.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The indexed set, in sitemap order. '/' is landing.spec.ts's.
const PAGES = ["/about", "/trust", "/privacy", "/terms", "/market"] as const;

/* Recorded a11y debt, per page and per rule — never a blanket waiver.
 *
 * Every entry is a `color-contrast` finding from the fixed Spark art direction
 * (docs/design/README.md exempts app/landing/ from the token gate precisely
 * because these hexes are chosen, not derived). Structure, names, roles,
 * landmarks and labels are gated outright on every page here.
 *
 * The list must only ever SHRINK: a page whose holdout is no longer needed
 * fails the "still needed?" assertion below until its entry is deleted. */
// Recorded contrast debt, measured against kp's own dev server on 2026-09-04 (the lot
// that wrote this file had audited a DIFFERENT app on :3000 and believed the list empty):
//   /about   36 about-art step badges (.w-10.h-10.rounded-xl) - white on the art colours
//   /trust   one .text-coral link on the cream ground
//   /privacy one .text-meta line; /terms one .text-meta line
//   /market  11 gold (#caa54c) rank ticks in the JD gallery
// Palette choices are an OWNER decision (docs/harness; Perfect vault). Each entry is
// asserted to STILL fail below, so fixing one deletes it here.
const A11Y_HOLDOUTS: Record<string, string[]> = {
  "/about": ["color-contrast"],
  "/trust": ["color-contrast"],
  "/privacy": ["color-contrast"],
  "/terms": ["color-contrast"],
  "/market": ["color-contrast"]
};

/** Serious/critical WCAG violations — the same pragmatic bar the rest of the
 *  suite uses (landing, analyze-smoke, token-doors-axe). */
async function seriousViolations(page: Page): Promise<{ id: string; detail: string }[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, detail: `${v.id} (${v.impact}) — ${v.nodes.length} node(s): ${v.nodes[0]?.target.join(" ")}` }));
}

test("/about carries the shared legal row every public front door owes", async ({ page }) => {
  await page.goto("/about");
  const footer = page.getByRole("contentinfo");
  const legal = footer.getByRole("navigation", { name: "Legal" });
  await expect(legal).toBeVisible();
  for (const [name, href] of [
    ["Privacy", "/privacy"],
    ["Terms", "/terms"],
    ["Trust & compliance", "/trust"]
  ] as const) {
    await expect(legal.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});

test("/about has phone navigation, keyboard-dismissible like the landing's", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/about");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  const home = page.getByRole("link", { name: "Home" }).first();
  await expect(home).toBeVisible();

  // Escape closes the disclosure and hands focus back to the toggle — the same
  // useDialogA11y contract e2e/landing.spec.ts pins for the landing menu.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

for (const path of PAGES) {
  test(`${path} passes axe beyond its recorded holdouts`, async ({ page }) => {
    await page.goto(path);
    // Bands animate in on scroll (framer whileInView), so walk the page to the
    // bottom first — an un-entered band is still at opacity 0 and axe would
    // audit a page the visitor never sees.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));
    const found = await seriousViolations(page);
    const tolerated = A11Y_HOLDOUTS[path] ?? [];
    expect(
      found.filter((v) => !tolerated.includes(v.id)).map((v) => v.detail),
      `serious a11y violations on ${path}`
    ).toEqual([]);
    // Recorded, not waived: a rule listed for this page must STILL be failing,
    // so fixing it fails here until the entry is deleted.
    for (const id of tolerated) {
      expect(
        found.some((v) => v.id === id),
        `${path} no longer needs its "${id}" holdout — delete it`
      ).toBe(true);
    }
  });
}
