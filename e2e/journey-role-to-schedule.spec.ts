// Critical-path journey: first-run wizard (IMPORT path) → JD in the Library →
// recruiter mints a self-scheduling invite from the pipeline drawer → the
// candidate (fresh context, no auth cookie) books a slot on /schedule/[token] →
// the recruiter's Schedule tab reflects the confirmed interview → the candidate
// withdraws (terminal card), freeing the slot so repeated runs don't drain the
// 21-day horizon.
//
// FULLY DETERMINISTIC — no GEMINI/Claude/ElevenLabs key is needed anywhere:
//   • the wizard's IMPORT path saves the JD as-is (POST /api/jds) — the only AI
//     step (ingest-job's LLM parse) is fire-and-forget in the product and never
//     asserted here;
//   • /api/extract-text shells to the local Python extractor (pipeline.jobfit.
//     extract_cli) — Python + repo deps must be on PATH, same requirement as
//     `npm run build` (schemas:gen);
//   • scheduling slots are computed server-side (schedule-slots.ts), no
//     external calendar is configured in e2e.
//
// CI invocation (for the keyless job — no .env.local, no API keys):
//   npm ci && npx playwright install --with-deps chromium
//   npm run build                        # runs schemas:gen (needs Python deps)
//   npm run start -- --port 3101 &      # prod server against data/kp.sqlite
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test \
//     e2e/journey-role-to-schedule.spec.ts e2e/modal-escape.spec.ts e2e/profile-builder.spec.ts
// (Without KP_E2E_BASE_URL the same three specs run against the managed dev
//  webServer: `npx playwright test e2e/journey-role-to-schedule.spec.ts
//  e2e/modal-escape.spec.ts e2e/profile-builder.spec.ts`.)
//
// A fresh DB self-seeds pipeline entries from data/seed_pipeline on first boot,
// and seedDevAuth stamps the first-run gate, so this file needs no manual seed.
// Copy assertions deliberately avoid the public landing (another workstream owns
// that copy); every asserted string lives in the workspace/schedule namespaces.
import path from "path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// The journey's steps share minted state (JD title, invite token), so they run
// serially in one worker; a step failure skips the dependent remainder.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

// Unique per run so Library assertions can't collide with earlier journeys
// persisted in the same dev database.
const runId = Date.now().toString(36);
const JD_TITLE = `E2E Journey QA Automation Engineer ${runId}`;
const jdFixture = path.join(process.cwd(), "e2e", "fixtures", "journey-jd.txt");

// Shared across the serial steps.
let candidateLabel = "";
let inviteToken = "";
let inviteUrl = "";

// Same pragmatic axe gate as analyze-smoke.spec.ts: fail on serious/critical
// WCAG A/AA violations only.
//
// KNOWN EXCLUSION — `.text-coral`: the app-wide EYEBROW recipe
// (app/_components/ui/recipes.ts: "text-meta uppercase text-coral") puts coral
// #d65a4a on paper #fdf8ee, which measures 3.65:1 — under the 4.5:1 AA bar for
// 14px text. That is a design-token-level brand decision (coral is also the
// focus ring and score-weak color), not something this suite can restyle, so the
// decorative kicker is excluded rather than the color-contrast rule disabled.
// Everything else on the candidate pages stays fully contrast-checked. If the
// design system ever darkens light-theme coral, delete this exclusion.
async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude(".text-coral")
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
}

// Advance one wizard step. Clicks only while the SOURCE step is still visible
// (a registered click crossfades it away within ~300ms), so a slow animation
// can never trigger a double-advance past the target; a click lost to the dev
// hydration gap leaves the source visible and gets retried.
async function advanceStep(source: Locator, button: Locator, target: Locator): Promise<void> {
  await expect(async () => {
    if (!(await target.isVisible())) {
      if (await source.isVisible()) {
        await button.click().catch(() => undefined);
        await expect(source).toBeHidden({ timeout: 2500 }).catch(() => undefined);
      }
      await expect(target).toBeVisible({ timeout: 2500 });
    }
  }).toPass({ timeout: 30_000 });
}

test("first-run wizard IMPORT path saves the JD and it lands in the Library", async ({ page }) => {
  // `?onboarding=1` is the single-load escape hatch — it opens the LIVE wizard
  // regardless of the workspace's onboarding stamp (app/page.tsx).
  await page.goto("/?onboarding=1");
  const wizard = page.getByRole("dialog", { name: "Set up your workspace" });
  await expect(wizard).toBeVisible();

  // Welcome → Company.
  const welcome = wizard.getByRole("heading", { name: "Let's get you hiring" });
  const company = wizard.getByRole("heading", { name: "Make it your company" });
  await advanceStep(welcome, wizard.getByRole("button", { name: "Let's go" }), company);

  // Company: org name is the step's required input (cookie-backed — no DB row).
  await wizard.locator("#setup-org-name").fill("E2E Journey Co");
  const team = wizard.getByRole("heading", { name: "Bring your team in" });
  await advanceStep(company, wizard.getByRole("button", { name: "Continue" }), team);

  // Team: explicitly skippable — no invites in this journey.
  const firstRole = wizard.getByRole("heading", { name: "Describe your first role" });
  await advanceStep(team, wizard.getByRole("button", { name: "Skip for now" }), firstRole);

  // First role, IMPORT mode: upload the fixture JD; /api/extract-text (the
  // Python extractor) fills the body and the file name derives no title because
  // we set ours first.
  const importRadio = wizard.getByRole("radio", { name: "Import existing" });
  await expect(async () => {
    if (!(await importRadio.isChecked())) await importRadio.click().catch(() => undefined);
    await expect(importRadio).toBeChecked({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  await wizard.locator("#setup-role-title").fill(JD_TITLE);
  await wizard.locator('input[type="file"]').setInputFiles(jdFixture);
  // The extractor round-trip proves /api/extract-text worked (generous budget —
  // the first Python spawn on a cold machine is the slow one).
  await expect(wizard.locator("#setup-role-import-body")).toHaveValue(/QA Automation Engineer/, {
    timeout: 60_000
  });

  const handoff = wizard.getByRole("heading", { name: "You're all set" });
  await advanceStep(firstRole, wizard.getByRole("button", { name: "Continue" }), handoff);

  // Finish via "Explore on my own" — persistOnboardingSetup POSTs the imported
  // JD to /api/jds (the ingest-job follow-up is best-effort and not asserted).
  let jdSaved: { slug?: string } | null = null;
  const jdResponse = page
    .waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/jds" && r.request().method() === "POST",
      { timeout: 60_000 }
    )
    .then(async (r) => {
      expect(r.ok(), `POST /api/jds responded ${r.status()}`).toBe(true);
      jdSaved = (await r.json()) as { slug?: string };
      return r;
    });
  const soloTile = wizard.getByRole("button", { name: /Explore on my own/ });
  await expect(async () => {
    if (!jdSaved) await soloTile.click().catch(() => undefined);
    expect(jdSaved, "the wizard's finish should POST the imported JD").not.toBeNull();
  }).toPass({ timeout: 60_000 });
  await jdResponse;
  expect(jdSaved!.slug, "saved JD should carry a slug").toBeTruthy();
  // Deliberately do NOT wait for the wizard to close itself: after the /api/jds
  // save it fires a best-effort ingest-job follow-up, and on a machine with LLM
  // keys that call runs an unbounded AI parse before finish() unwinds. The JD is
  // already persisted (response above); navigating away is the deterministic end
  // of the wizard, exactly as it is for a real user who moves on.

  // The imported JD is visible in the Library ledger.
  await page.goto("/?tab=library");
  await expect(page.getByRole("button", { name: JD_TITLE }).first()).toBeVisible({ timeout: 30_000 });
});

test("recruiter mints a self-scheduling invite from the candidate drawer", async ({ page }) => {
  // Pick a real schedulable entry (active + Screened/Interview — the drawer's
  // showLinks gate) from the live board data, then drive the actual UI to it.
  const list = await page.request.get("/api/pipeline");
  expect(list.ok()).toBe(true);
  const { entries } = (await list.json()) as {
    entries: Array<{ id: string; candidateLabel: string; stage: string; status: string }>;
  };
  const target = entries.find((e) => e.status === "active" && ["Screened", "Interview"].includes(e.stage));
  expect(target, "seeded pipeline should contain an active Screened/Interview entry").toBeTruthy();
  candidateLabel = target!.candidateLabel;

  // `?q=` pre-filters the board to the one candidate, so the card is never
  // hidden behind a "+N more" cell overflow.
  await page.goto(`/?tab=pipeline&q=${encodeURIComponent(candidateLabel)}`);
  const drawer = page.getByRole("dialog");
  const aiActions = page.getByRole("button", { name: `AI actions for ${candidateLabel}` }).first();
  await expect(aiActions).toBeVisible({ timeout: 30_000 });
  // Same dev-hydration retry as the sibling specs: click until the drawer opens.
  await expect(async () => {
    if (!(await drawer.isVisible())) await aiActions.click().catch(() => undefined);
    await expect(drawer).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });

  // Mint the link through the drawer's real Self-scheduling panel.
  const inviteResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/schedule/invite" && r.request().method() === "POST"
  );
  await drawer.getByRole("button", { name: "Create scheduling link" }).click();
  const invite = await inviteResponse;
  expect(invite.ok(), `POST /api/schedule/invite responded ${invite.status()}`).toBe(true);
  const minted = (await invite.json()) as { token: string; url: string };
  expect(minted.token).toBeTruthy();
  inviteToken = minted.token;
  inviteUrl = minted.url;

  // The panel surfaces the candidate-facing link (absolute URL in the copy field).
  await expect(drawer.locator(`input[value*="${inviteToken}"]`)).toBeVisible();
});

test("candidate books a slot on /schedule/[token] — picker and booked states pass axe", async ({ browser }) => {
  // A NEW context: the candidate holds only the tokenized link — no kp_entered
  // cookie, no recruiter session.
  const candidateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const candidatePage = await candidateContext.newPage();
  try {
    await candidatePage.goto(inviteUrl);
    await expect(candidatePage.getByRole("heading", { name: "Pick a time" })).toBeVisible();

    // Offered slots (server-computed, collision-aware). 21 business days × 2
    // slots minus booked ones — the horizon can't be empty in e2e.
    const firstSlot = candidatePage.locator("li > button").first();
    await expect(firstSlot).toBeVisible({ timeout: 30_000 });

    // a11y sweep #1 — the slot-picker state of the public candidate page.
    await expectNoSeriousA11yViolations(candidatePage);

    await firstSlot.click();
    const bookedCard = candidatePage.getByRole("status").filter({ hasText: "You're booked" });
    await expect(bookedCard).toBeVisible({ timeout: 30_000 });

    // a11y sweep #2 — the booked/confirmation state.
    await expectNoSeriousA11yViolations(candidatePage);
  } finally {
    await candidateContext.close();
  }
});

test("recruiter side reflects the confirmed booking", async ({ page }) => {
  // API truth first: the exact minted invite is now confirmed with a slot.
  const scheduleView = await page.request.get("/api/schedule");
  expect(scheduleView.ok()).toBe(true);
  const { invites } = (await scheduleView.json()) as {
    invites: Array<{ token: string; status: string; slotAt: string | null }>;
  };
  const mine = invites.find((i) => i.token === inviteToken);
  expect(mine, "the minted invite should appear in the recruiter schedule feed").toBeTruthy();
  expect(mine!.status).toBe("confirmed");
  expect(mine!.slotAt).toBeTruthy();

  // And the Schedule tab's lifecycle panel shows the candidate on the agenda.
  await page.goto("/?tab=schedule");
  const lifecycle = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Interviews & invites" }) });
  await expect(lifecycle.getByText(candidateLabel).first()).toBeVisible({ timeout: 30_000 });
});

test("candidate withdraws — terminal card renders and passes axe, slot is freed", async ({ browser }) => {
  const candidateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const candidatePage = await candidateContext.newPage();
  try {
    await candidatePage.goto(inviteUrl);
    // The confirmed invite renders the booked card; withdraw is its terminal exit.
    await expect(candidatePage.getByRole("status").filter({ hasText: "You're booked" })).toBeVisible();
    await candidatePage.getByRole("button", { name: "I need to withdraw from this interview" }).click();
    const closedCard = candidatePage.getByRole("status").filter({ hasText: "This interview is no longer open" });
    await expect(closedCard).toBeVisible({ timeout: 30_000 });

    // a11y sweep #3 — the dead-link/terminal state.
    await expectNoSeriousA11yViolations(candidatePage);
  } finally {
    await candidateContext.close();
  }
});
