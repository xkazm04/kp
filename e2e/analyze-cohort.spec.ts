// Analyze is the Cohort Studio (the v1 upload form was retired on 2026-11-10).
//
// Keyless and deterministic, in two halves:
//
//  1. The LIVE studio over the install's own routes: the tab lands on the role-first
//     studio (no upload form, no prototype switcher), a legacy `?variant=v1` link is
//     consumed harmlessly, and `?jd=<slug>` opens that role's cast step. These read
//     /api/jds and /api/analyze/cohort/proposal only — no engine, no writes.
//
//  2. The full flow — pick the role, see the proposal, start, land in Line-up, walk
//     into a dimension, switch the "Explain by" layer — runs on the studio's WALKTHROUGH
//     data mode (`?cohortFixture=walkthrough`): the real flow components over the
//     committed fixture, a simulated run, nothing fetched from the install, nothing
//     written. Why not a live run: a keyless install cannot file an analysis against a
//     JD (the CV engine has no deterministic fallback, and no keyless route writes an
//     `analyses` row), so a live cohort has nothing to reuse and every fresh member
//     would fail. The walkthrough is dev-only (`NODE_ENV !== "production"`), so this
//     half skips against a production build and says why.
//
// Not in KEYLESS_SPECS (playwright.config.ts): the second half needs a dev server.
import { expect, test, type Page } from "@playwright/test";
import { seedDevAuth } from "./dev-auth";

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

const LAYERS = ["Overview", "Verdict ledger", "Score anatomy", "Head-to-head", "Criteria matrix"] as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

test.describe("Analyze — the cohort studio is the product", () => {
  test("the tab lands on the role-first studio; ?variant=v1 is consumed, not obeyed", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/?tab=analyze&variant=v1");
    await expect(page.locator("[data-cohort-studio]")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /which role\?/i })).toBeVisible({ timeout: 30_000 });
    // The retired form's controls are gone, and so is the prototype world switch.
    await expect(page.getByLabel("Job description text")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: /^prototype$/i })).toHaveCount(0);
    // The inbox empties the bar.
    await expect(page).not.toHaveURL(/variant=/);
    expect(errors).toEqual([]);
  });

  test("?jd=<slug> opens that role's cast step", async ({ page, request }) => {
    const errors = collectPageErrors(page);
    const res = await request.get("/api/jds?limit=200");
    expect(res.ok()).toBeTruthy();
    const { jds } = (await res.json()) as { jds: Array<{ slug: string; title: string }> };
    test.skip(jds.length === 0, "the install has no saved JD to deep-link to");
    const role = jds[0];
    await page.goto(`/?tab=analyze&jd=${encodeURIComponent(role.slug)}`);
    // Step 2 of the slate is current, and it names the role once the proposal loads.
    await expect(page.getByRole("heading", { name: /^who is compared$|^nobody to compare/i }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(role.title).first()).toBeVisible();
    await expect(page).not.toHaveURL(/jd=/);
    expect(errors).toEqual([]);
  });
});

test.describe("Analyze — role to Line-up to a layer (walkthrough data)", () => {
  test("pick the role, start, land in Line-up, open a dimension, switch every layer", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto("/?tab=analyze&cohortFixture=walkthrough");
    const studio = page.locator("[data-cohort-studio]");
    await expect(studio).toBeVisible({ timeout: 60_000 });
    test.skip(
      (await page.locator("[data-cohort-dev]").count()) === 0,
      "the walkthrough data mode is dev-only; a production build always reads live data"
    );
    // The inbox adopts ?cohortFixture= after the first frame.
    await expect(studio).toHaveAttribute("data-cohort-studio", "walkthrough", { timeout: 30_000 });

    // 1. The role.
    const role = page.getByRole("button", { name: /Senior Java Backend Engineer/i }).first();
    await expect(role).toBeVisible({ timeout: 30_000 });
    await role.click();

    // 2. The proposal: a tray of candidates and the start button that counts them.
    const start = page.getByRole("button", { name: /^Compare \d+ candidates$/ });
    await expect(start).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /who is compared/i }).first()).toBeVisible();
    await start.click();

    // 3. The (simulated) run lands in the Line-up world.
    await expect(page.locator('[data-cohort-walkthrough="done"]')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("group", { name: /^The street: \d+ candidates/ })).toBeVisible();

    // 4. Walk into the skills floor from the street's directory.
    await page.locator('.k-layer[data-depth="0"] .lu-dir [data-row="skills"]').first().click();
    const layers = page.getByRole("radiogroup", { name: "Explain by" });
    await expect(layers).toBeVisible({ timeout: 30_000 });
    // The default layer is the ledger.
    await expect(layers.getByRole("radio", { name: "Verdict ledger" })).toHaveAttribute("aria-checked", "true");

    // 5. Every layer renders in place.
    for (const name of LAYERS) {
      await layers.getByRole("radio", { name }).click();
      await expect(layers.getByRole("radio", { name })).toHaveAttribute("aria-checked", "true");
    }
    await expect(page.locator("[data-cohort-layer-host]")).toHaveAttribute("data-cohort-layer-host", "matrix");
    expect(errors).toEqual([]);
  });
});
