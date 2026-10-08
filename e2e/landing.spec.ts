// The public landing, end to end — the one surface an anonymous visitor ever
// sees. Since 2026-09-30 it is the port of the approved fused prototype
// (app/landing/site/, rendered by app/landing/spark/SparkHome.tsx): a header with
// the section nav, nine bands, the features band's ring of nine medallions, and
// a full-screen scene per feature.
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
// The last test calls /api/demo, which on an open-mode server mints a demo
// workspace: that one writes.
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Every band of the page, by the id the header nav, the phone menu, the spine
// and the footer navigate to. Kept in page order so the scroll walk is monotonic.
const BANDS = ["top", "proof", "features", "voice", "human", "pricing", "enterprise", "start"] as const;

/* The landing's contrast debt, recorded NODE BY NODE rather than waived per band.
 *
 * Measured 2026-09-30 against the port (1280x800 and 390x844, with and without
 * reduced motion): ONE serious finding on the whole page.
 *
 *   #top  `.c-petr > .verdict`  "worth a call" on the hero's middle CV card:
 *         gold #a8842b on the card's #fffdf7, 3.44:1 at 15px bold (AA wants 4.5:1).
 *         The colour is the approved prototype's own (`--tone:#a8842b` on
 *         .contest/fusion/v1/index.html's `.c-petr`), i.e. an art-direction value
 *         the port reproduced on purpose; deepening it is the owner's call.
 *
 * So the gate is drawn where it can be held honestly and still bite:
 *   - NO serious violation of any rule, anywhere on the page or in any band,
 *     except `color-contrast` on exactly the nodes listed here.
 *   - a listed node that no longer fails turns this suite red until its entry is
 *     deleted: the list must only ever shrink. */
const CONTRAST_HOLDOUTS: Record<string, readonly string[]> = {
  "#top": [".c-petr > .verdict"]
};
const ALL_HOLDOUT_NODES = new Set(Object.values(CONTRAST_HOLDOUTS).flat());

/* The same record for the nine feature scenes (the full-screen dialog each
 * medallion opens), measured the same day, scene view. Four of the nine paint
 * their small type in the feature's "soft" tint on its own ground below AA, and
 * all four are byte-identical to the approved prototype (same colours, same
 * ratios, audited on .contest/fusion/v1/index.html): an art-direction finding
 * for the owner, not a port defect.
 *
 *   inbox       #a9d2cc on #2f6664  3.98:1  crumbs, count, one-line pitch
 *   rediscover  #dbe6df on #72827b  3.15:1  the same four; and the panel's two
 *               dimmed "earlier applicant" rows, #74787c 4.41:1 / #8e9fa5 2.72:1
 *   voice       #f3b5a9 on #ab483b  3.22:1  the four; and the panel caption 4.37:1
 *   salary      #f1dc9d on #a18132  2.71:1  the four; the panel caption 2.99:1; and
 *               the body copy, cream at 94% (#f7f1e3) on the same ground, 3.27:1 */
const SCENE_TEXT = [".sc-crumb > span:nth-child(1)", ".sc-crumb > span:nth-child(2)", ".sc-count", ".sc-line"];
const SCENE_CONTRAST_HOLDOUTS: Record<string, readonly string[]> = {
  inbox: SCENE_TEXT,
  score: [],
  rediscover: [
    ...SCENE_TEXT,
    ".dim:nth-child(2) > div > b",
    ".dim:nth-child(2) > div > small",
    ".dim:nth-child(3) > div > b",
    ".dim:nth-child(3) > div > small"
  ],
  voice: [...SCENE_TEXT, ".sc-mock > .m-cap"],
  cases: [],
  schedule: [],
  salary: [...SCENE_TEXT, ".sc-body", ".sc-mock > .m-cap"],
  offer: [],
  gates: []
};

type Finding = { id: string; targets: string[]; detail: string };

/** Serious/critical WCAG violations — the same pragmatic bar the rest of the
 *  suite uses (analyze-smoke, token-doors-axe, public-pages). */
async function seriousFindings(page: Page, selector?: string): Promise<Finding[]> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  if (selector) builder = builder.include(selector);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => {
      const targets = v.nodes.map((n) => n.target.join(" "));
      return { id: v.id, targets, detail: `${v.id} (${v.impact}) — ${v.nodes.length} node(s): ${targets.join(", ")}` };
    });
}

/** Everything but `color-contrast` on a recorded node is a failure. */
function untolerated(found: Finding[], allowed: ReadonlySet<string>): string[] {
  return found
    .map((f) => (f.id === "color-contrast" ? { ...f, targets: f.targets.filter((t) => !allowed.has(t)) } : f))
    .filter((f) => f.targets.length > 0)
    .map((f) => (f.id === "color-contrast" ? `color-contrast on unrecorded node(s): ${f.targets.join(", ")}` : f.detail));
}

/** The nine medallions of the features ring, by their accessible names. */
const medal = (page: Page, name: string): Locator =>
  page.locator("#features").getByRole("button", { name: new RegExp(`^${name}, \\d of 9\\. Opens its own scene\\.$`) });

/** The open feature scene: a modal dialog named by its feature's title. */
const scene = (page: Page, name: string): Locator => page.getByRole("dialog", { name, exact: true });

const focusInside = (dialog: Locator) => dialog.evaluate((el) => el.contains(document.activeElement));

test("anonymous '/' renders the public landing, not the workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("#features")).toBeVisible();
  // The landing's own header nav names every band…
  const sections = page.getByRole("navigation", { name: "Page sections" });
  await expect(sections).toBeVisible();
  for (const name of ["Proof", "Features", "Voice", "Pricing"]) {
    await expect(sections.getByRole("link", { name, exact: true })).toBeVisible();
  }
  // …and the workspace's section rail is nowhere on an ungated visit.
  await expect(page.getByRole("tablist", { name: "Workspace sections" })).toHaveCount(0);
});

test("the skip link is the first stop and lands on the nine features", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to the nine features" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute("href", "#features");
});

/** Wait until every FINITE CSS animation and transition on the page has ended
 *  (the looping decorations never end, so they are left out): axe skips what is
 *  still transparent, and a mid-fade audit is a coin toss. */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined))
    )
  );
}

/** Recorded, not waived: every listed node must STILL fail, so fixing a colour
 *  fails the caller until its entry is deleted. */
function expectRecordedStillFail(found: Finding[], recorded: readonly string[], where: string) {
  const contrast = found.find((f) => f.id === "color-contrast")?.targets ?? [];
  for (const node of recorded) {
    expect(contrast, `${where} ${node}: contrast holdout still needed?`).toContain(node);
  }
}

test.describe("a11y", () => {
  // Audited in the page's reduced-motion state: every state is then SETTLED
  // (the hero starts fully scored, reveals are in place, a scene opens without
  // its colour wipe), so axe measures what a reader sees rather than a frame of
  // a transition. The motion itself is the prototype's and is not what is gated.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("nothing serious on the landing beyond the recorded contrast nodes", async ({ page }) => {
    await page.goto("/");
    // Reduced motion starts the hero fully scored: its verdicts fade in at once.
    await expect(page.locator(".c-petr.scored")).toBeVisible();
    await settle(page);
    expect(untolerated(await seriousFindings(page), ALL_HOLDOUT_NODES), "serious a11y violations on the landing").toEqual([]);
    for (const band of BANDS) {
      await page.locator(`#${band}`).scrollIntoViewIfNeeded();
      await expect(page.locator(`#${band}`)).toBeVisible();
      await settle(page);
      const recorded = CONTRAST_HOLDOUTS[`#${band}`] ?? [];
      const found = await seriousFindings(page, `#${band}`);
      expect(untolerated(found, new Set(recorded)), `serious a11y violations in #${band}`).toEqual([]);
      expectRecordedStillFail(found, recorded, `#${band}`);
    }
  });

  test("nothing serious in any of the nine scenes beyond the recorded contrast nodes", async ({ page }) => {
    for (const [key, recorded] of Object.entries(SCENE_CONTRAST_HOLDOUTS)) {
      // A fresh document per scene: from one /#spotlight- address to the next is
      // a same-document hash change, i.e. a timed scene SWAP, not an arrival.
      await page.goto("about:blank");
      await page.goto(`/#spotlight-${key}`);
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      const found = await seriousFindings(page, "#scene");
      expect(untolerated(found, new Set(recorded)), `serious a11y violations in the ${key} scene`).toEqual([]);
      expectRecordedStillFail(found, recorded, `scene ${key}`);
    }
  });
});

test("the ring's nine medallions are named buttons, one per feature", async ({ page }) => {
  await page.goto("/");
  await page.locator("#features").scrollIntoViewIfNeeded();
  // The band's outline is its h2; each medallion is a button whose name says
  // what it is, where it sits in the nine, and that it opens a scene. The
  // drawn number and label inside it are aria-hidden, so the name is not
  // read twice.
  await expect(page.locator("#features").getByRole("heading", { level: 2 })).toHaveCount(1);
  const medals = page.locator("#features").getByRole("button", { name: /, \d of 9\. Opens its own scene\.$/ });
  await expect(medals).toHaveCount(9);
  await expect(medals.nth(1)).toHaveAccessibleName("Job-fit scoring, 2 of 9. Opens its own scene.");
});

test("a scene opens from its medallion, keeps focus inside, and Escape restores it", async ({ page }) => {
  await page.goto("/");
  await page.locator("#features").scrollIntoViewIfNeeded();
  const opener = medal(page, "Job-fit scoring");
  await opener.click();

  const dialog = scene(page, "Job-fit scoring");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");

  // Focus moved INSIDE the dialog on open…
  await expect.poll(() => focusInside(dialog)).toBe(true);
  // …and Tab cycles within it rather than walking the page behind.
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusInside(dialog)).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

// An open scene is an address (/#spotlight-<key>) and a walk (the stepper's
// named arrows, ArrowLeft/ArrowRight) over the nine features in ring order. The
// pure half - the order, the wrap, the hash grammar, what closing restores - is
// pinned in app/landing/spark/previews/order.test.ts; this is the browser half.
test("a scene is addressable as /#spotlight-<key> and walkable with the arrow keys", async ({ page }) => {
  await page.goto("/#spotlight-cases");
  const cases = scene(page, "Verified work samples");
  await expect(cases).toBeVisible();
  await expect(cases).toContainText("05 of 09");
  await expect.poll(() => focusInside(cases)).toBe(true);

  await page.keyboard.press("ArrowRight");
  const schedule = scene(page, "Self-scheduling");
  await expect(schedule).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#spotlight-schedule");

  await schedule.getByRole("button", { name: "Previous: Verified work samples" }).click();
  await expect(scene(page, "Verified work samples")).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#spotlight-cases");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const hash = await page.evaluate(() => location.hash);
  expect(hash.startsWith("#spotlight-")).toBe(false);
  // The address never touched the path: canonical `/` stays `/`.
  expect(new URL(page.url()).pathname).toBe("/");
});

test("the phone-width menu navigates the page and is keyboard-dismissible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // The toggle is a disclosure: "Menu" closed, "Close" open, aria-expanded in step.
  const toggle = page.locator("#bar").getByRole("button", { name: /^(Menu|Close)$/ });
  await expect(toggle).toHaveAccessibleName("Menu");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  const menu = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toHaveAccessibleName("Close");
  const pricing = menu.getByRole("link", { name: "Pricing", exact: true });
  await expect(pricing).toBeVisible();
  // The language line and the real locale switch ride along in the menu.
  await expect(menu).toContainText("Four languages, candidate side included:");
  await pricing.click();
  await expect(page).toHaveURL(/#pricing$/);
  await expect(page.locator("#pricing")).toBeInViewport();
  // Following a link closes the menu.
  await expect(menu).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Escape closes the disclosure and hands focus back to the toggle.
  await toggle.click();
  await expect(menu.getByRole("link", { name: "Pricing", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(toggle).toHaveAccessibleName("Menu");
  await expect(toggle).toBeFocused();
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
  // The landing now carries other live regions (the gate, the unattended log),
  // so the notice is picked out by its own sentence, not by role alone.
  const notice = page.getByRole("status").filter({ hasText: "The live demo is unavailable" });
  await expect(notice).toContainText("The live demo is unavailable right now.");
  await expect(notice).toContainText("The live demo is not set up on this deployment yet.");
  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);
});
