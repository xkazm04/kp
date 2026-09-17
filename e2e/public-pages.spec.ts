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
// Recorded contrast debt, measured against kp's own production build on 2026-09-04
// (the lot that first wrote this file had audited a DIFFERENT app on :3000 and believed
// the list empty; the re-measure that replaced it named /market's nodes wrongly, which
// is why each entry below now says which ELEMENT fails and at what ratio):
//   /about   36 about-art step badges (.w-10.h-10.rounded-xl) - white on the art colours
//   /trust, /privacy, /terms  ONE node each, and it is the same element on all three:
//            the EYEBROW recipe (`text-meta uppercase text-coral`), coral #d65a4a at
//            14px on the cream paper, 3.65:1 against a 4.5:1 bar. Axe selects it as
//            `.text-coral` on /trust (where other .text-meta nodes exist) and as
//            `.text-meta` on the other two. One token pairing, three pages.
// Whether coral stays legible-on-cream is a PALETTE decision and therefore the owner's
// (docs/harness; Perfect vault) - it is the brand's accent on the brand's ground, and
// darkening it moves every eyebrow in the product.
//
// /market had its own entry and no longer does: eleven gold (#caa54c, 2.33:1) occupation
// rank ticks and eight org-type labels drawn in the encoding colour (coral 3.87:1, amber
// 2.33:1) were LOCAL choices, not palette ones, and were fixed in market/parts.tsx - the
// ticks deepened, and the org colour moved off the text onto a swatch beside it. The page
// now reports zero serious violations.
//
// The list must only ever SHRINK; each entry is asserted to STILL fail below, so fixing
// one turns this suite red until the entry is deleted.
const A11Y_HOLDOUTS: Record<string, string[]> = {
  "/about": ["color-contrast"],
  "/trust": ["color-contrast"],
  "/privacy": ["color-contrast"],
  "/terms": ["color-contrast"]
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

// A shared /about link unfurls from these tags. Next merges metadata SHALLOWLY, so a
// page that sets its own `openGraph` replaces the root layout's whole object: /about
// once shipped og:title and og:description and nothing else, losing og:type,
// og:site_name, og:locale and the opengraph-image, while twitter:* kept the SITE's
// title under the page's own og:title. The site-wide values are read off '/', not
// typed here, so the assertion follows the layout rather than a copy of it. No `head`
// in the selector, like shell.spec's hreflang check: metadata may stream into <body>.
test("/about's share tags keep the site's OpenGraph and a matching Twitter card", async ({ page }) => {
  const KEYS = [
    "og:type", "og:site_name", "og:locale", "og:image", "og:title", "og:description",
    "twitter:title", "twitter:description", "twitter:image"
  ] as const;
  const tagsOf = async (path: string) => {
    await page.goto(path);
    const out: Record<string, string | null> = {};
    for (const key of KEYS) {
      const attr = key.startsWith("og:") ? "property" : "name";
      const tag = page.locator(`meta[${attr}="${key}"]`).first();
      out[key] = (await tag.count()) ? await tag.getAttribute("content") : null;
    }
    return out;
  };
  const site = await tagsOf("/");
  const about = await tagsOf("/about");

  for (const key of ["og:type", "og:site_name", "og:locale", "og:image"] as const) {
    expect(site[key], `'/' no longer emits ${key}; this test has nothing to compare against`).toBeTruthy();
    expect(about[key], `/about dropped ${key}`).toBe(site[key]);
  }
  expect(about["og:title"], "/about must carry its own og:title").not.toBe(site["og:title"]);
  expect(about["twitter:title"]).toBe(about["og:title"]);
  expect(about["twitter:description"]).toBe(about["og:description"]);
  expect(about["twitter:image"], "/about's summary_large_image card has no image").toBeTruthy();
});

test("/about emits AboutPage + SoftwareApplication JSON-LD matching the document title", async ({ page }) => {
  await page.goto("/about");
  const scripts = page.locator('script[type="application/ld+json"]');
  await expect(scripts).toHaveCount(1);
  const json = JSON.parse((await scripts.first().textContent()) ?? "null") as {
    "@graph"?: Record<string, unknown>[];
  };
  const nodes = json["@graph"] ?? [];
  const typeOf = (n: Record<string, unknown>) =>
    ([] as unknown[]).concat(n["@type"] ?? []).map(String);
  const types = nodes.flatMap(typeOf);
  expect(types, "/about JSON-LD @graph types").toEqual(
    expect.arrayContaining(["AboutPage", "SoftwareApplication"])
  );
  const aboutPage = nodes.find((n) => typeOf(n).includes("AboutPage"));
  expect(aboutPage, "AboutPage node").toBeTruthy();
  expect(aboutPage!.name).toBe(await page.title());
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
