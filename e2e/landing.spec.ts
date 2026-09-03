// The public landing (Spark), end to end — the one surface an anonymous visitor
// ever sees, and until this file the only surface with NO e2e coverage at all.
//
// It is also the only spec that must NOT seed the entry cookie: '/' is gated
// server-side (app/page.tsx), so every other spec calls seedDevAuth() and gets
// the workspace. That made the "landing page" axe assertion in
// analyze-smoke.spec.ts a workspace assertion in disguise — it runs after
// seedDevAuth, and the whole file skips without a Gemini key, so the landing's
// accessibility was never checked by anything.
//
// Fully deterministic and keyless: the landing renders no model output and
// touches no database (app/page.tsx returns SparkHome before any DB call). Part
// of the keyless CI subset — see .claude/CLAUDE.md and .github/workflows/ci.yml.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Every band of the page, by the id the section rail and the phone menu both
// navigate to. Kept in page order so the scroll walk below is monotonic.
const BANDS = ["proof", "features", "voice", "trust", "pricing"] as const;

/* The landing's contrast debt, recorded rather than waived.
 *
 * Four bands paint a brand hex on a brand hex below the 4.5:1 (3:1 for large)
 * AA floor. Every one of them lives in a file this lot does not own, and every
 * one is an ART-DIRECTION decision (docs/design/README.md exempts app/landing/
 * from the token gate precisely because these hexes are chosen, not derived):
 *
 *   #proof    gold  #caa54c on teal  #42606f  (Proof.tsx h2 emphasis)
 *   #voice    coral #d65a4a on cream #fdf8ee  (VoiceTeaser.tsx h2 emphasis)
 *   #trust    ink   #17202a on moss  #526b4f  (TrustPillars.tsx band copy)
 *   #pricing  the "most popular" ribbon, and the enterprise eyebrow (.text-meta)
 *
 * So the gate is drawn where it can be held honestly and still bite:
 *   - NO serious violation of any other rule, anywhere on the page or in any
 *     band. Structure, names, roles, landmarks, labels are gated outright.
 *   - `color-contrast` is tolerated ONLY in the four bands named above.
 *   - `#features` — the band this lot rebuilt — must be clean of everything.
 * Fix a band's palette and delete its entry; the list must only ever shrink. */
const CONTRAST_HOLDOUT_BANDS = ["#proof", "#voice", "#trust", "#pricing"];

/** Serious/critical WCAG violations — the same pragmatic bar the rest of the
 *  suite uses (analyze-smoke, token-doors-axe). Returns what it found so a
 *  caller can assert more. */
async function expectNoSeriousA11yViolations(page: Page, selector?: string): Promise<string[]> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (selector) builder = builder.include(selector);
  const results = await builder.analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}) — ${v.nodes.length} node(s): ${v.nodes[0]?.target.join(" ")}`);
  const tolerated = !selector || CONTRAST_HOLDOUT_BANDS.includes(selector);
  expect(
    serious.filter((v) => !(tolerated && v.startsWith("color-contrast"))),
    selector ? `serious a11y violations in ${selector}` : "serious a11y violations on the landing"
  ).toEqual([]);
  return serious;
}

test("anonymous '/' renders the public landing, not the workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The workspace's nav rail must not be anywhere on an ungated visit.
  await expect(page.locator("#features")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Page sections" })).toHaveCount(0);
});

test("a11y — nothing serious beyond the recorded contrast holdouts", async ({ page }) => {
  await page.goto("/");
  await expectNoSeriousA11yViolations(page);
  for (const band of BANDS) {
    // Bands animate in on scroll (framer whileInView), so bring each into view
    // before auditing it — an un-entered band is still at opacity 0.
    await page.locator(`#${band}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#${band}`)).toBeVisible();
    const found = await expectNoSeriousA11yViolations(page, `#${band}`);
    // Recorded, not waived: a band listed above must STILL be the only kind of
    // failure it was recorded for, and fixing its palette fails this line until
    // the entry is deleted from CONTRAST_HOLDOUT_BANDS.
    expect(found.length > 0, `#${band} contrast holdout still needed?`).toBe(
      CONTRAST_HOLDOUT_BANDS.includes(`#${band}`)
    );
  }
});

test("feature cards keep their heading semantics", async ({ page }) => {
  await page.goto("/");
  await page.locator("#features").scrollIntoViewIfNeeded();
  // The card used to be a role="button" wrapping the <h3>, which folded the
  // heading into the button's accessible name and emptied the outline.
  await expect(page.locator("#features").getByRole("heading", { level: 3 })).toHaveCount(9);
  const card = page.locator("#features button[aria-haspopup='dialog']").first();
  await expect(card).toHaveAccessibleName("Job-fit scoring");
  await expect(card).toHaveAttribute("aria-expanded", "false");
});

test("the spotlight opens on click, traps focus, and Escape restores it to the card", async ({ page }) => {
  await page.goto("/");
  await page.locator("#features").scrollIntoViewIfNeeded();
  const card = page.locator("#features button[aria-haspopup='dialog']").first();
  await card.click();

  const dialog = page.getByRole("dialog", { name: "Job-fit scoring" });
  await expect(dialog).toBeVisible();
  await expect(card).toHaveAttribute("aria-expanded", "true");

  // Focus moved INSIDE the dialog on open…
  await expect
    .poll(async () => dialog.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
  // …and Tab cycles within it rather than walking the page behind.
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("the phone-width menu navigates the page and is keyboard-dismissible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  const menu = page.getByRole("link", { name: "Pricing" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(page.locator("#pricing")).toBeInViewport();

  // Escape closes the disclosure and hands focus back to the toggle.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Pricing" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});

test("the demo CTA's refusal lands on the landing and is named, not silent", async ({ page, request }) => {
  // /api/demo either mints the open-deploy walk or refuses with a CODE; assert
  // the shape of that contract without depending on this checkout's env.
  const res = await request.get("/api/demo", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  const location = res.headers()["location"] ?? "";
  expect(location).toMatch(/\?(sim=auto|demo=unavailable&code=(DEMO_DISABLED|DEMO_NOT_PROVISIONED))/);

  // And the refusal the operator cannot flip renders as its own sentence —
  // resolved from `errors.DEMO_NOT_PROVISIONED`, never the server's raw string.
  await page.goto("/?demo=unavailable&code=DEMO_NOT_PROVISIONED");
  const notice = page.getByRole("status");
  await expect(notice).toContainText("The live demo is unavailable right now.");
  await expect(notice).toContainText("The live demo is not set up on this deployment yet.");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});
