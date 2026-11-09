// THE KEYLESS HIRE, end to end, as one flow with ONE role and ONE person, through the
// screens a recruiter and a candidate actually use:
//   job ad pasted → job published → candidate applies → moved to Interview →
//   the recruiter files the HUMAN scorecard → the verdict is accepted → an offer is
//   drafted by hand from the job's salary band → the recruiter sends it → the candidate opens
//   /offer/[token] and clicks Accept → the entry is Hired.
//
// WHY THIS FILE EXISTS. A user with no LLM key is rated BY HAND
// (docs/features/hiring-pipeline/keyless-rating.md), and the form that records that
// rating was unreachable on the default plan: the Schedule tab opens it only from its
// human-round branch and the shipped plan runs an AI round alone. Every door passed its
// own unit tests. Only walking the whole path could show that one of them had no way in.
//
// FULLY DETERMINISTIC, no provider anywhere:
//   • POST /api/jobs/ingest parses the pasted ad deterministically keyless;
//   • quick apply files a candidate with no analyzed profile, which is the hard case:
//     the AI prep and offer tasks both refuse them, so nothing below can depend on one;
//   • the rating is typed by a person, and nothing here asserts or invents an AI score;
//   • the offer is the recruiter's own draft (a template letter, verdictSource
//     "template", priced from the job's band), and it stops at the offer_review gate.
//
// No (SIM) job, no /api/sim route, no direct DB write: the `simCalls` listener below
// fails the last step if the journey ever touches a demo door.
//
// INVOCATION. The suite's managed server is keyless only when the box is: pass
// KP_OFFLINE=1, which turns every provider's available() false, including the Claude CLI.
//   KP_OFFLINE=1 npx playwright test e2e/journey-job-to-accept.spec.ts
import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// The steps share minted state (job id, entry id, offer link), so they run serially in
// one worker; a step failure skips the dependent rest.
test.describe.configure({ mode: "serial" });

const simCalls: string[] = [];

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    // The one exemption: the shell's simulation console reads its status on mount with a
    // GET that claims nothing and purges nothing. Any other sim call fails the journey.
    if (path.startsWith("/api/sim/") && !(path === "/api/sim/reset" && r.method() === "GET")) simCalls.push(`${r.method()} ${path}`);
  });
});

// Unique per run: this spec writes real rows and must collide with neither an earlier
// run nor the seeded corpus.
const runId = Date.now().toString(36);
const ROLE_TITLE = `Keyless Accept Engineer ${runId}`;
const CANDIDATE = `Noor Haddad ${runId}`;
const CANDIDATE_EMAIL = `noor.haddad.${runId}@example.com`;
const BAND_MIN = 80_000;
const BAND_MAX = 100_000;
const JOB_AD = [
  ROLE_TITLE,
  "",
  "We are hiring a senior backend engineer to build and operate our payment APIs in Prague.",
  `Salary ${BAND_MIN} to ${BAND_MAX} CZK per month.`,
  "Must have TypeScript, Node.js and PostgreSQL. Nice to have Kafka.",
  "You will own the reliability of the settlement jobs, work with product on delivery,",
  "review code and mentor colleagues across the engineering team. Hybrid work, English required.",
].join("\n");

let jobId = "";
let entryId = "";
let offerLink = "";

type EntryRead = { entry: { id: string; stage: string; status: string; approvalKind: string | null; approvalDetail: string | null } };

async function readEntry(page: Page): Promise<EntryRead["entry"]> {
  const res = await page.request.get(`/api/pipeline/${entryId}`);
  expect(res.ok(), `GET /api/pipeline/[id] responded ${res.status()}`).toBe(true);
  return ((await res.json()) as EntryRead).entry;
}

/** Open the candidate from the board's Matches table, retrying a click the dev hydration
 *  gap ate. The name carries the run id, so the row is unique on the board. */
async function openCandidate(page: Page): Promise<Locator> {
  await page.goto(`/?tab=pipeline&q=${encodeURIComponent(CANDIDATE)}`);
  const modal = page.getByRole("dialog", { name: CANDIDATE, exact: true });
  const row = page.getByRole("table", { name: "Matches", exact: true }).getByRole("row").filter({ hasText: CANDIDATE }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(async () => {
    if (!(await modal.isVisible())) await row.click({ timeout: 1000 }).catch(() => undefined);
    await expect(modal).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  return modal;
}

/** Open this candidate's decision in the Decisions docket. */
async function openDecision(page: Page): Promise<Locator> {
  await page.goto("/?tab=decisions");
  await expect(page.getByText("Your decision queue")).toBeVisible({ timeout: 60_000 });
  const row = page.getByRole("listitem").filter({ hasText: CANDIDATE });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  const modal = page.getByRole("dialog", { name: CANDIDATE, exact: true });
  await expect(async () => {
    if (!(await modal.isVisible())) await row.getByRole("button", { name: `Decide on ${CANDIDATE}` }).first().click({ timeout: 1000 }).catch(() => undefined);
    await expect(modal).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 30_000 });
  return modal;
}

test("a pasted job ad becomes a published job, with no LLM", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/?tab=jobs");

  const importButton = page.getByRole("button", { name: "Import position" });
  const adField = page.locator("#ingest-ad");
  await expect(async () => {
    if (!(await adField.isVisible())) await importButton.click({ timeout: 2000 }).catch(() => undefined);
    await expect(adField).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await adField.fill(JOB_AD);

  const ingested = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/jobs/ingest" && r.request().method() === "POST", { timeout: 120_000 });
  await page.getByRole("button", { name: "Add to catalog" }).click();
  const response = await ingested;
  expect(response.ok(), `POST /api/jobs/ingest responded ${response.status()}`).toBe(true);
  const body = (await response.json()) as { jobId: string; source: string };
  jobId = body.jobId;
  expect(jobId).toBeTruthy();
  expect(body.source, "the ad must be parsed on the keyless path").toBe("deterministic");

  // ?tab= is consumed on load, so a reload would land on Overview: navigate back.
  await page.goto("/?tab=jobs");
  const draft = page.locator(`li[data-sim-entry="${jobId}"]`);
  await expect(draft).toBeVisible({ timeout: 60_000 });
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (!(await dialog.isVisible())) await draft.getByRole("button", { name: "Publish" }).click({ timeout: 2000 }).catch(() => undefined);
    await expect(dialog).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const published = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/jobs/${jobId}/publish`, { timeout: 180_000 });
  await dialog.getByRole("button", { name: /^(Publish|Open|Confirm)/ }).last().click();
  const done = await published;
  expect(done.ok(), `POST /api/jobs/[id]/publish responded ${done.status()}`).toBe(true);
});

test("the candidate applies through the public form", async ({ browser, page }) => {
  test.setTimeout(180_000);
  // A NEW context: the candidate holds only the public link, no recruiter cookie.
  const candidateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const candidatePage = await candidateContext.newPage();
  try {
    await candidatePage.goto(`/apply/${jobId}/quick`);
    // Each control is re-driven until it holds, so a click the hydration gap eats is retried.
    await expect(async () => {
      await candidatePage.locator("#qa-name").fill(CANDIDATE);
      await candidatePage.locator("#qa-email").fill(CANDIDATE_EMAIL);
      const yes = candidatePage.getByRole("button", { name: "Yes", exact: true });
      for (let i = 0; i < (await yes.count()); i++) {
        await yes.nth(i).click({ timeout: 2000 });
        await expect(yes.nth(i)).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
      }
    }).toPass({ timeout: 60_000 });
    // The form also opens a funnel /session on this prefix, so the door is matched exactly.
    const applied = candidatePage.waitForResponse((r) => new URL(r.url()).pathname === `/api/apply/${jobId}/quick` && r.request().method() === "POST", { timeout: 90_000 });
    await candidatePage.getByRole("button", { name: "Apply now" }).click();
    const response = await applied;
    expect(response.ok(), `the application responded ${response.status()}`).toBe(true);
    const outcome = (await response.json()) as { result: string };
    expect(outcome.result, `the application outcome was ${JSON.stringify(outcome)}`).toBe("accepted");
  } finally {
    await candidateContext.close();
  }

  await expect(async () => {
    const board = await page.request.get("/api/pipeline");
    const entries = ((await board.json()) as { entries: Array<{ id: string; jobId: string; candidateLabel: string; stage: string }> }).entries;
    const mine = entries.filter((e) => e.jobId === jobId && e.candidateLabel === CANDIDATE);
    expect(mine, "one application files one entry").toHaveLength(1);
    entryId = mine[0].id;
    expect(mine[0].stage).toBe("Accepted");
  }).toPass({ timeout: 30_000 });
});

test("the recruiter moves the candidate to Interview and files the human scorecard", async ({ page }) => {
  test.setTimeout(300_000);
  const modal = await openCandidate(page);

  for (const [label, stage] of [[/Screened/, "Screened"], [/Interview/, "Interview"]] as const) {
    const moved = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/pipeline/${entryId}` && r.request().method() === "POST", { timeout: 60_000 });
    await modal.getByRole("contentinfo").or(modal.locator("footer")).getByRole("button", { name: label }).last().click();
    expect((await moved).ok(), `the move to ${stage} must land`).toBe(true);
    await expect.poll(async () => (await readEntry(page)).stage, { timeout: 30_000 }).toBe(stage);
  }

  // THE DOOR THIS JOURNEY EXISTS FOR, on a plan whose Schedule tab is AI-only.
  await modal.getByRole("button", { name: "Prep & scorecard" }).click();
  const prep = page.getByRole("dialog", { name: new RegExp(CANDIDATE) }).last();
  await expect(prep).toBeVisible({ timeout: 60_000 });

  // Quick-apply leaves no analyzed profile, so no plan can be generated: the form is
  // there regardless, because the rating is the recruiter's own.
  const score = prep.getByRole("button", { name: "Score this interview" });
  await expect(score).toBeVisible({ timeout: 60_000 });
  await score.click();

  // The rubric's rows are 1..5 buttons; the first row is enough for a rated scorecard.
  const four = prep.getByRole("button", { name: "4", exact: true }).first();
  await four.click();
  await expect(four).toHaveAttribute("aria-pressed", "true");
  const advance = prep.getByRole("button", { name: "Advance", exact: true }).first();
  await advance.click();
  await expect(advance).toHaveAttribute("aria-pressed", "true");
  const filed = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/interview-prep/scorecard" && r.request().method() === "POST", { timeout: 60_000 });
  await prep.getByRole("button", { name: "Save scorecard" }).click();
  const response = await filed;
  expect(response.ok(), `POST /api/interview-prep/scorecard responded ${response.status()}`).toBe(true);
  expect(((await response.json()) as { gated: boolean }).gated, "the verdict must reach the Decisions queue").toBe(true);
  await expect(prep.getByText("Verdict recorded. Moved to the Decisions queue.")).toBeVisible();

  // The rating is on the record as a PERSON's, never as machine output.
  const entry = await readEntry(page);
  expect(entry.approvalKind).toBe("scorecard_review");
  expect((JSON.parse(entry.approvalDetail ?? "{}") as { source?: string }).source).toBe("human");
});

test("accepting the human verdict moves the candidate to Offer, and a keyless offer is drafted", async ({ page }) => {
  test.setTimeout(240_000);
  const decision = await openDecision(page);
  const accepted = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/pipeline/${entryId}` && r.request().method() === "POST", { timeout: 60_000 });
  await decision.locator('[data-sim-click="accept"]').click();
  expect((await accepted).ok()).toBe(true);
  await expect.poll(async () => (await readEntry(page)).stage, { timeout: 30_000 }).toBe("Offer");

  const modal = await openCandidate(page);
  // The AI draft refuses a candidate with no analyzed profile; this door does not.
  await modal.getByRole("button", { name: "Draft offer by hand" }).click();
  const drafted = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/pipeline/${entryId}` && r.request().method() === "POST", { timeout: 60_000 });
  await modal.getByRole("button", { name: "Create draft" }).click();
  const response = await drafted;
  expect(response.ok(), `draft_offer responded ${response.status()}`).toBe(true);
  await expect(modal.getByText("Drafted. Approve it in Decisions to send it.")).toBeVisible();

  const entry = await readEntry(page);
  expect(entry.approvalKind, "a drafted offer waits for a human").toBe("offer_review");
  const draft = JSON.parse(entry.approvalDetail ?? "{}") as { verdictSource?: string; recommended?: number | null; salaryMin?: number | null; salaryMax?: number | null };
  expect(draft.verdictSource, "a keyless letter is a template and says so").toBe("template");
  if (draft.salaryMin != null && draft.salaryMax != null) {
    expect(draft.recommended, "an empty figure defaults to the band midpoint").toBe(Math.round((draft.salaryMin + draft.salaryMax) / 2));
  } else {
    expect(draft.recommended, "with no band on the job, no figure is invented").toBeNull();
  }
});

test("the recruiter sends the offer and the candidate accepts it on /offer/[token]", async ({ browser, page }) => {
  test.setTimeout(240_000);
  const decision = await openDecision(page);
  const sent = page.waitForResponse((r) => new URL(r.url()).pathname === `/api/pipeline/${entryId}` && r.request().method() === "POST", { timeout: 90_000 });
  await decision.locator('[data-sim-click="accept"]').click();
  const response = await sent;
  expect(response.ok(), `sending the offer responded ${response.status()}`).toBe(true);
  const extended = (await response.json()) as { offerExtended: boolean; link: string };
  expect(extended.offerExtended).toBe(true);
  offerLink = new URL(extended.link).pathname;
  expect(offerLink).toMatch(/^\/offer\//);

  const candidateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const candidatePage = await candidateContext.newPage();
  try {
    await candidatePage.goto(offerLink);
    const accept = candidatePage.getByRole("button", { name: "Accept offer" });
    await expect(accept).toBeVisible({ timeout: 60_000 });
    const answered = candidatePage.waitForResponse((r) => new URL(r.url()).pathname === `/api${offerLink}` && r.request().method() === "POST", { timeout: 60_000 });
    await expect(async () => {
      await accept.click({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    const answer = await answered;
    expect(answer.ok(), `POST /api/offer/[token] responded ${answer.status()}`).toBe(true);
    expect(((await answer.json()) as { status: string }).status).toBe("accepted");
  } finally {
    await candidateContext.close();
  }

  await expect.poll(async () => (await readEntry(page)).stage, { timeout: 30_000 }).toBe("Hired");

  // The audit trail names a person for the rating and the offer.
  const records = await page.request.get(`/api/decisions/records?candidate=${entryId}`);
  expect(records.ok()).toBe(true);
  const audit = (await records.json()) as { records: Array<{ kind: string; actor: string }>; chain: { ok: boolean } };
  const scorecard = audit.records.find((r) => r.kind === "human_scorecard");
  expect(scorecard?.actor.startsWith("human:"), "the rating is sealed as a human's").toBe(true);
  expect(audit.records.find((r) => r.kind === "offer_terms")?.actor.startsWith("human:"), "a person extended the offer").toBe(true);
  expect(audit.chain.ok).toBe(true);

  expect(simCalls, "this journey must never touch a demo door").toEqual([]);
});
