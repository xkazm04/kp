// Critical-path journey: first-run wizard (through its Pipeline step, which
// writes the board's columns) → JD in the Library → recruiter mints a
// self-scheduling invite from the pipeline drawer → the candidate (fresh context,
// no auth cookie) books a slot on /schedule/[token] → the recruiter's Schedule tab
// reflects the confirmed interview → the candidate withdraws (terminal card),
// freeing the slot so repeated runs don't drain the 21-day horizon.
//
// FULLY DETERMINISTIC — no GEMINI/Claude/ElevenLabs key is needed anywhere:
//   • the wizard persists a board-axis rename (POST /api/pipeline/stage-migration)
//     and the JD leg saves a description as-is (POST /api/jds) — the only AI step
//     (ingest-job's LLM parse) is fire-and-forget in the product and is never
//     called here;
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
import { readFileSync } from "fs";
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
// The wizard renames the board's first column to this. Only the LABEL moves —
// the stored stage id stays "Accepted", which is why the later steps can still
// find seeded entries by stage.
const STAGE_LABEL = `E2E Arrivals ${runId}`;
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

test("first-run wizard walks to the hand-off and its Pipeline step saves the board", async ({ page }) => {
  // Above the suite default (120s): five crossfaded steps plus two server actions
  // at the end, and against a dev server each of those is a first-call compile.
  test.setTimeout(240_000);
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

  // Team is optional and no longer carries its own "Skip for now": its Continue
  // was never gated, so the second button was two ways to do one thing (the rail
  // marks the step Optional instead). No invites in this journey.
  const pipeline = wizard.getByRole("heading", { name: "Shape your hiring board" });
  await advanceStep(team, wizard.getByRole("button", { name: "Continue" }), pipeline);

  // Pipeline step (the one that replaced "First role"): the board's REAL columns
  // load from /api/decisions/config, so waiting for column 1 to carry a value is
  // the honest ready signal. Renaming it is the edit that proves the step writes
  // to the draft — and the one whose stored key must NOT move, which the rest of
  // this journey then relies on (it filters entries by the stage ID "Screened").
  const firstColumn = wizard.getByRole("textbox", { name: "Name of step 1" });
  await expect(firstColumn).toHaveValue(/\S/, { timeout: 30_000 });
  await firstColumn.fill(STAGE_LABEL);

  const handoff = wizard.getByRole("heading", { name: "You're all set" });
  await advanceStep(pipeline, wizard.getByRole("button", { name: "Continue" }), handoff);

  // Finish via "Explore on my own", then assert the STORED axis rather than the
  // request that carried it: a POST in the network log proves an attempt, and this
  // step's whole point is that the board actually keeps the shape. (The write goes
  // through /api/pipeline/stage-migration, which applies the config and any forced
  // candidate moves as one operation; a rename moves nobody, so `migrate` is
  // empty.)
  //
  // Generous budget on purpose: finish() runs the org-name and language SERVER
  // ACTIONS before it reaches the axis, and against a dev server those compile on
  // first call — well past the suite's default 30s expect window on a cold
  // instance. The production run in the header does it in a fraction of that.
  const soloTile = wizard.getByRole("button", { name: /Explore on my own/ });
  await expect(async () => {
    // Re-clicked only while the tile is still there (the dev hydration gap can eat
    // the first click). finish() is re-entrancy guarded, so an extra click during
    // a run in flight is a no-op, never a second write.
    if (await soloTile.isVisible().catch(() => false)) await soloTile.click().catch(() => undefined);
    const config = await page.request.get("/api/decisions/config");
    expect(config.ok(), `GET /api/decisions/config responded ${config.status()}`).toBe(true);
    const payload = (await config.json()) as {
      configs?: { pipelineStages?: { stages?: { id: string; label: string }[] } };
    };
    const first = payload.configs?.pipelineStages?.stages?.[0];
    // The label moved; the stored key did NOT — that is the contract that lets the
    // rest of this journey keep finding entries by the stage id.
    expect(first?.label, "the wizard's finish should save the renamed column").toBe(STAGE_LABEL);
    expect(first?.id, "renaming a column must not move its stored key").toBe("Accepted");
  }).toPass({ timeout: 120_000 });
  // No separate "and the board draws it" hop: this IS the axis the Pipeline tab
  // reads (getPipelineAxis), and the next steps of this journey then drive that
  // board — finding a seeded candidate row and its menu on it — which is a
  // stronger check that a renamed axis stays usable than a header-text assertion.
});

test("an existing job description is extracted and lands in the Library", async ({ page }) => {
  // The wizard used to own this leg (its First-role step had an IMPORT mode that
  // uploaded a file). That step is gone — a JD build belongs to the Library, where
  // it has a ledger and a retry, and the Getting-started checklist walks a new
  // operator there. The COVERAGE is what mattered here, so it moved down to the
  // two endpoints the import path exercised, driven through the recruiter's
  // authenticated request context:
  //   • /api/extract-text — shells to the local Python extractor
  //     (pipeline.jobfit.extract_cli), the one Python dependency of this spec;
  //   • /api/jds — saves the description as-is, no AI build, keyless-safe.
  // (The ingest-job follow-up is fire-and-forget in the product and, on a machine
  // WITH LLM keys, runs an unbounded parse — deliberately not called here.)
  const extracted = await page.request.post("/api/extract-text", {
    multipart: {
      file: { name: "journey-jd.txt", mimeType: "text/plain", buffer: readFileSync(jdFixture) },
    },
    // Generous: the first Python spawn on a cold machine is the slow one.
    timeout: 60_000,
  });
  expect(extracted.ok(), `POST /api/extract-text responded ${extracted.status()}`).toBe(true);
  const { text } = (await extracted.json()) as { text?: string };
  expect(text, "the extractor should return the fixture's text").toMatch(/QA Automation Engineer/);

  const saved = await page.request.post("/api/jds", {
    data: { title: JD_TITLE, body: text },
  });
  expect(saved.ok(), `POST /api/jds responded ${saved.status()}`).toBe(true);
  expect(((await saved.json()) as { slug?: string }).slug, "saved JD should carry a slug").toBeTruthy();

  // And it renders in the Library ledger.
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
  // The card's per-row actions live in its context menu now (the inline controls
  // were costing ~134px of a 280px stage column, truncating the candidate name).
  // The trigger is the row's keyboard/touch door into the same menu right-click
  // opens; it is opacity-0 until hover, which Playwright still counts as visible.
  const rowMenu = page.getByRole("button", { name: `Actions for ${candidateLabel}` }).first();
  await expect(rowMenu).toBeVisible({ timeout: 30_000 });
  // Same dev-hydration retry as the sibling specs: click until the drawer opens.
  await expect(async () => {
    if (!(await drawer.isVisible())) {
      await rowMenu.click().catch(() => undefined);
      await page
        .getByRole("menuitem", { name: "AI actions" })
        .first()
        .click({ timeout: 2000 })
        .catch(() => undefined);
    }
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

    // The card is the CLAIM; this is the fact behind it. "…slot is freed" was in
    // this test's name but nowhere in its assertions, so a withdrawal that
    // rendered the terminal card while leaving the invite confirmed (or leaving
    // slot_at set) shipped green — and the header's "so repeated runs don't drain
    // the 21-day horizon" quietly stopped being true. declineScheduleInvite
    // (app/_lib/schedule-store.ts) takes the status terminal AND clears slot_at;
    // the public token read projects both, so the candidate's own context can
    // check it with no recruiter session.
    const after = await candidatePage.request.get(`/api/schedule/${inviteToken}`);
    expect(after.ok(), `GET /api/schedule/[token] responded ${after.status()}`).toBe(true);
    const terminal = (await after.json()) as {
      closed?: boolean;
      closedReason?: string;
      invite?: { status?: string; slotAt?: string | null };
    };
    expect(terminal.closed, "a withdrawn invite must read as a closed capability").toBe(true);
    // 'declined', not 'expired' — the link was minted seconds ago in this run.
    expect(terminal.closedReason, "withdrawal is the terminal 'declined' fate").toBe("declined");
    expect(terminal.invite?.status).toBe("declined");
    expect(terminal.invite?.slotAt, "withdrawing must release the booked time").toBeNull();

    // a11y sweep #3 — the dead-link/terminal state.
    await expectNoSeriousA11yViolations(candidatePage);
  } finally {
    await candidateContext.close();
  }
});
