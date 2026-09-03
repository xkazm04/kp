// THE THREAD, end to end, as one flow with ONE role and ONE person:
//   JD saved → job ingested (jd-<slug>) → assignment created FROM that job →
//   candidate applies through the assignment's own token → submission evaluated →
//   promote joins the real job and a real profile → the board shows one row whose
//   score is NAMED a transfer score → the voice screen is offered from the
//   submission → a human seals a decision → the Decisions queue and the sealed
//   decision-record chain both show it.
//
// WHY THIS FILE EXISTS. Every leg of that sentence had a test; the SEAMS between
// them had none, and the seams are where the data used to break (a candidate
// existing twice under two synthetic ids, a transfer score rendered as a match
// score, a voice screen unreachable from the assignment). journey-role-to-schedule
// walks the scheduling thread and stops at the board. This walks the assessment
// thread and asserts, at each seam, that the SAME ids survive it.
//
// FULLY DETERMINISTIC — no GEMINI / Claude / ElevenLabs key is needed anywhere:
//   • POST /api/jds/save ingests the structured job with NO LLM at all
//     (app/api/jds/save/ingest-job.ts — normalizeJob + insertJob, deterministic).
//     Note the sibling POST /api/jds/[slug]/ingest-job does NOT degrade: keyless
//     it answers 500 "No LLM provider available for ad ingestion", so the save
//     route is the only keyless door from a JD to a matchable job.
//   • every devcase step (analyze / design / evaluate / transfer / followups) is
//     an LLM call wrapped in a deterministic() fallback (pipeline/jobfit/devcase/
//     analyze.py, design.py, evaluate.py), so a keyless box always produces a
//     case and an evaluation — it just marks them `source: "deterministic"`;
//   • that mark is load-bearing here: gateApproval REFUSES to auto-approve a
//     deterministic design (devcase-orchestrator.ts:37-62), so the keyless run
//     parks at `awaiting_approval` and a human approve resumes it. This spec
//     asserts that refusal rather than working around it.
//   • POST /api/interview/create mints the session keyless; only the outbound
//     invite and the voice call itself need a provider (`configured: false`).
//
// CI invocation (the keyless job — no .env.local, no API keys):
//   npm ci && npx playwright install --with-deps chromium
//   npm run build
//   npm run start -- --port 3101 &
//   KP_E2E_BASE_URL=http://localhost:3101 npx playwright test e2e/journey-one-thread.spec.ts
//
// LOCAL: run it against a PRODUCTION build, not `next dev`. Two reasons, both
// measured on 2026-08-28: a dev server rebuilds on any file write and a rebuild
// mid-request leaves a client fetch hanging (the candidate page sits on
// "Loading…" past a 30s expect), and a developer's .env.local supplies real keys,
// which takes every step above off the deterministic path. Build, then:
//   node .next/standalone/server.js   with KP_ALLOW_OPEN=1 KP_OFFLINE=1
// KP_OFFLINE is what makes a keyed developer box behave like keyless CI: it turns
// every cloud provider's available() to false (pipeline/jobfit/llm/offline.py),
// including the Claude CLI, which is a subprocess the TS egress guard cannot see.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL, seedDevAuth } from "./dev-auth";

// The steps share minted state (slug, case id, token, submission id, entry id),
// so they run serially in one worker; a step failure skips the dependent rest.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await seedDevAuth(page);
});

// Unique per run: this spec writes real rows into the dev database and must never
// collide with an earlier run's, nor with the seeded corpus.
const runId = Date.now().toString(36);
const ROLE_TITLE = `E2E One Thread Payments Engineer ${runId}`;
const CANDIDATE = `Sam Okafor ${runId}`;
const CANDIDATE_EMAIL = `sam.okafor.${runId}@example.com`;

// Shared across the serial steps.
let jdSlug = "";
let jobId = "";
let caseId = "";
let applyToken = "";
let submissionId = "";
let entryId = "";

/** Poll a JSON endpoint until `done` accepts its body, or fail with the last body
 *  in the message. Every wait in this file goes through here so a timeout says
 *  WHAT the server last answered instead of only that time ran out. */
async function pollJson<T>(
  request: APIRequestContext,
  path: string,
  done: (body: T) => boolean,
  { timeout = 120_000, label = path }: { timeout?: number; label?: string } = {}
): Promise<T> {
  let last: unknown = null;
  await expect(async () => {
    const res = await request.get(path);
    expect(res.ok(), `GET ${path} responded ${res.status()}`).toBe(true);
    const body = (await res.json()) as T;
    last = body;
    expect(done(body), `${label} — last body: ${JSON.stringify(body).slice(0, 600)}`).toBe(true);
  }).toPass({ timeout, intervals: [500, 1000, 2000] });
  return last as T;
}

type Lifecycle = { id: string; stage: string; caseId: string | null; detail?: string | null };
type LifecycleFeed = { lifecycles: Lifecycle[] };

test("a JD becomes a job, and an assignment is cut FROM that job", async ({ page }) => {
  // The assignment leg runs a Python analyze + design per stage; keyless each is a
  // deterministic template, but the task queue still has to turn over.
  test.setTimeout(240_000);

  // 1 — the JD, and the matchable job in one write. `jobIngested` is the product's
  // own honesty flag: false means the draft exists but `jd-<slug>` does NOT, and
  // "Source into Pipeline" would dead-end (app/api/jds/save/route.ts:16-22). The
  // whole thread hangs off that id, so assert the flag, not just the 200.
  const saved = await page.request.post("/api/jds/save", {
    data: {
      title: ROLE_TITLE,
      body: `# ${ROLE_TITLE}\n\nBackend engineer for the payments service.\n\n## Stack\nTypeScript, Node.js, PostgreSQL.\n\n## Responsibilities\n- Build and operate the payment APIs\n- Own reliability of the settlement job\n`,
      company: "KandiDate e2e",
      role: {
        title: ROLE_TITLE,
        seniority: "medior",
        roleFamily: "software_engineering",
        languages: ["en"],
        responsibilities: ["Build and operate the payment APIs", "Own reliability of the settlement job"],
        mustHaves: ["TypeScript", "Node.js", "PostgreSQL"],
        niceToHaves: [],
      },
    },
  });
  expect(saved.ok(), `POST /api/jds/save responded ${saved.status()}`).toBe(true);
  const savedBody = (await saved.json()) as { slug: string; jobId: string; jobIngested: boolean };
  jdSlug = savedBody.slug;
  jobId = savedBody.jobId;
  expect(jdSlug, "the saved JD carries a slug").toBeTruthy();
  expect(savedBody.jobIngested, "the JD's role must reach the corpus as a matchable job").toBe(true);
  // THE identity contract the rest of the thread depends on (app/_lib/jd-limits.ts).
  expect(jobId, "JD and Job share one identity").toBe(`jd-${jdSlug}`);

  // 2 — the assignment, cut from THAT JD. `jdSlug` is the only link the form
  // carries, and resolveCaseJobId (app/_lib/db/devcase.ts:110-117) turns it into
  // dev_cases.job_id at write time — but ONLY if the jd-<slug> job actually
  // exists, which is exactly why step 1 asserts jobIngested.
  const started = await page.request.post("/api/devcase/lifecycle", {
    data: {
      need: {
        title: ROLE_TITLE,
        jdSlug,
        stack: ["TypeScript", "Node.js", "PostgreSQL"],
        seniorityTarget: "medior",
        roleFamily: "software_engineering",
        responsibilities: ["Build and operate the payment APIs"],
      },
      auto: true,
    },
  });
  expect(started.ok(), `POST /api/devcase/lifecycle responded ${started.status()}`).toBe(true);
  const lifecycleId = ((await started.json()) as { lifecycle: Lifecycle }).lifecycle.id;
  expect(lifecycleId).toBeTruthy();

  const mine = (feed: LifecycleFeed) => feed.lifecycles.find((l) => l.id === lifecycleId);
  const settled = await pollJson<LifecycleFeed>(
    page.request,
    "/api/devcase/lifecycle",
    (feed) => ["awaiting_approval", "published", "collecting", "ranked", "promoted", "failed"].includes(mine(feed)?.stage ?? ""),
    { label: "the assignment should reach its approval gate or go live" }
  );
  const parked = mine(settled)!;
  expect(parked.stage, "the assignment must not fail on the way to its gate").not.toBe("failed");

  // 3 — the gate. Keyless, `gateApproval` refuses to auto-approve because the
  // design fell back to a deterministic template, and says so in `detail`
  // (devcase-orchestrator.ts:37-62). That refusal is a PRODUCT PROPERTY worth
  // pinning: a self-hosted install must not publish an ungrounded assignment to
  // candidates behind the operator's back. With a provider configured the design
  // is LLM-grounded and the same run sails past the gate — both are correct, so
  // the branch is on the observed stage, and each arm carries its own assertion.
  if (parked.stage === "awaiting_approval") {
    expect(parked.detail, "a gate that refuses must say why").toBeTruthy();
    let approve = await page.request.post(`/api/devcase/lifecycle/${lifecycleId}/approve`, { data: {} });
    if (approve.status() === 422) {
      // The probe audit found no usable cover probes in the deterministic case.
      // Overriding is the documented recruiter decision (enforceProbeGate,
      // app/_lib/devcase-probe-audit.ts:105-116), not a way around the gate.
      approve = await page.request.post(`/api/devcase/lifecycle/${lifecycleId}/approve`, {
        data: { overrideProbeAudit: true },
      });
    }
    expect(approve.ok(), `POST /api/devcase/lifecycle/[id]/approve responded ${approve.status()}`).toBe(true);
  }

  const live = await pollJson<LifecycleFeed>(
    page.request,
    "/api/devcase/lifecycle",
    (feed) => ["collecting", "ranked", "promoted"].includes(mine(feed)?.stage ?? ""),
    { label: "an approved assignment should publish and start collecting" }
  );
  caseId = mine(live)!.caseId!;
  expect(caseId, "a live assignment has a case id").toBeTruthy();

  // 4 — SEAM 1, both directions. The job knows its assignments…
  const ofJob = await page.request.get(`/api/jobs/${jobId}/assignments`);
  expect(ofJob.ok(), `GET /api/jobs/[id]/assignments responded ${ofJob.status()}`).toBe(true);
  const listed = ((await ofJob.json()) as { assignments: Array<{ id: string }> }).assignments;
  expect(
    listed.map((a) => a.id),
    "the JD's job must list the assignment that was cut from it"
  ).toContain(caseId);

  // …and the candidate-facing channel for it exists, with a token.
  const postings = await page.request.get("/api/devcase/postings");
  expect(postings.ok()).toBe(true);
  const posting = ((await postings.json()) as {
    postings: Array<{ caseId: string; token: string; status: string }>;
  }).postings.find((p) => p.caseId === caseId);
  expect(posting, "publishing an assignment mints a candidate channel").toBeTruthy();
  expect(posting!.status).toBe("open");
  applyToken = posting!.token;
  expect(applyToken).toBeTruthy();

  // 5 — ONE VOCABULARY, ONE LEGEND, on the surface the recruiter actually reads.
  // The ledger says "Assignment"; the five status tones are one shared legend
  // (app/_lib/status-tone.ts + StatusChip.tsx), not a per-tab catalog.
  await page.goto("/?tab=assignments");
  await expect(page.getByRole("columnheader", { name: "Assignment" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Assignments" })).toBeVisible();
  await expect(page.getByText("Status legend")).toBeVisible();
  for (const tone of ["Not started", "In progress", "Waiting on a person", "Done", "Stopped"]) {
    await expect(page.getByText(tone, { exact: true }).first()).toBeVisible();
  }
  // And the assignment names its role — the job link, rendered (DevCaseJobLink).
  await page.getByRole("button", { name: new RegExp(escapeRe(ROLE_TITLE)) }).first().click();
  await expect(page.getByText(`Role: ${ROLE_TITLE}`)).toBeVisible({ timeout: 30_000 });
  // Same word on the way back out. This literal is not in any message catalog, so
  // it is the one place the vocabulary guards cannot reach — assert it here.
  await expect(page.getByRole("button", { name: "All assignments" })).toBeVisible();
});

test("the candidate applies through the assignment's own link — and never sees the probes", async ({ browser, page }) => {
  test.setTimeout(120_000);
  // A NEW context: the candidate holds only the tokenized link — no kp_entered
  // cookie, no recruiter session. Everything below is what Sam can reach.
  const candidateContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const candidatePage = await candidateContext.newPage();
  try {
    await candidatePage.goto(`/devcase/apply/${applyToken}`);
    await expect(candidatePage.getByText("Take-home assignment")).toBeVisible({ timeout: 30_000 });
    await expect(candidatePage.getByRole("heading", { level: 1 })).toContainText(ROLE_TITLE);

    // PROBE SAFETY. The brief is rendered through caseToMarkdown, which excludes
    // probes by construction, and the internal panel (DevCaseDetailInternal) is
    // mounted only on the operator side. There is no positive "no probes here"
    // element to assert, so assert the absence — the candidate's own DOM must not
    // contain the reviewer-side vocabulary.
    const body = await candidatePage.locator("body").innerText();
    expect(body, "the candidate page must not leak the reviewer's rubric").not.toMatch(/\bcover probe|answer key|internal material|red flag\b/i);

    // The work surface: a real editor over the materialized seed, not a textarea.
    await expect(candidatePage.getByRole("heading", { name: "Work the assignment here" })).toBeVisible();

    // Submit through the session API from the CANDIDATE's own context — same three
    // calls LiveWorkSurface makes (create → flush events+files → finalize), driven
    // directly because the editor's 8s autosave loop is a timing dependency this
    // spec has no reason to take. The token is re-checked on every one of them
    // (403 otherwise), so this is the candidate's capability, not a back door.
    const session = await candidatePage.request.post("/api/devcase/session", {
      data: { token: applyToken, candidateRef: CANDIDATE },
    });
    expect(session.ok(), `POST /api/devcase/session responded ${session.status()}`).toBe(true);
    const sessionId = ((await session.json()) as { sessionId: string }).sessionId;

    const now = new Date().toISOString();
    const flush = await candidatePage.request.post(`/api/devcase/session/${sessionId}`, {
      data: {
        token: applyToken,
        events: [
          { kind: "file_open", path: "DECISIONS.md", at: now },
          { kind: "file_edit", path: "DECISIONS.md", at: now },
        ],
        files: [
          {
            path: "DECISIONS.md",
            content:
              "# Decisions\n\n1. Made the settlement job idempotent on an external key rather than a local lock.\n2. Left retry policy to the queue, because a second owner of retries is a second source of truth.\n",
          },
        ],
      },
    });
    expect(flush.ok(), `POST /api/devcase/session/[id] responded ${flush.status()}`).toBe(true);

    const submitted = await candidatePage.request.post(`/api/devcase/session/${sessionId}/submit`, {
      data: { token: applyToken, candidate: CANDIDATE, contact: CANDIDATE_EMAIL },
    });
    expect(submitted.ok(), `POST /api/devcase/session/[id]/submit responded ${submitted.status()}`).toBe(true);
    // The candidate is handed an OPAQUE reference, never the store id (wave 23).
    const receipt = (await submitted.json()) as { reference?: string; submissionId?: string };
    expect(receipt.reference).toMatch(/^ref-[0-9a-f]{10}$/);
    expect(receipt.submissionId, "the store id never rides the public wire").toBeUndefined();
  } finally {
    await candidateContext.close();
  }

  // The OPERATOR reads the submission id from the postings feed, where the
  // received submissions are inlined per posting.
  const withSubmissions = await page.request.get("/api/devcase/postings");
  expect(withSubmissions.ok()).toBe(true);
  const received = ((await withSubmissions.json()) as {
    postings: Array<{ caseId: string; submissions: Array<{ id: string }> }>;
  }).postings.find((p) => p.caseId === caseId)?.submissions ?? [];
  expect(received.length, "the finalize landed as ONE submission on the posting").toBe(1);
  submissionId = received[0].id;
  expect(submissionId).toBeTruthy();
});

test("evaluate and promote join the REAL job and ONE real person", async ({ page }) => {
  test.setTimeout(180_000);

  const task = await page.request.post("/api/tasks", {
    data: { kind: "evaluate_submission", params: { submissionId } },
  });
  expect(task.ok(), `POST /api/tasks responded ${task.status()}`).toBe(true);
  const taskId = ((await task.json()) as { task: { id: string } }).task.id;
  await pollJson<{ task: { status: string; error?: unknown } }>(
    page.request,
    `/api/tasks/${taskId}`,
    (b) => b.task.status === "succeeded" || b.task.status === "failed",
    { label: "the submission evaluation should finish" }
  );
  const finished = await page.request.get(`/api/tasks/${taskId}`);
  expect(((await finished.json()) as { task: { status: string } }).task.status, "evaluation must not fail").toBe(
    "succeeded"
  );

  const promoted = await page.request.post("/api/devcase/promote", { data: { submissionId } });
  expect(promoted.ok(), `POST /api/devcase/promote responded ${promoted.status()}`).toBe(true);
  const promotion = (await promoted.json()) as { entryId: string | null; recommendation: string | null };
  entryId = promotion.entryId!;
  expect(entryId, "promote must land the candidate on the board").toBeTruthy();
  expect(["advance", "hold"], "promote issues a recommendation, never nothing").toContain(promotion.recommendation);

  // SEAM 2 + SEAM 3 — the whole point of the milestone, in one read of the board.
  const board = await page.request.get("/api/pipeline");
  expect(board.ok()).toBe(true);
  const entries = ((await board.json()) as { entries: BoardEntry[] }).entries;
  const fromSubmission = entries.filter((e) => e.devSubmissionId === submissionId);
  // ONE candidate. The defect this replaces minted a second identity per promote,
  // so the person who applied and the person on the board were different rows.
  expect(fromSubmission, "one submission promotes to exactly one board entry").toHaveLength(1);
  const mine = fromSubmission[0];
  expect(mine.id).toBe(entryId);

  // The REAL job, not a synthetic dc-<caseId>.
  expect(mine.jobId, "the promoted entry belongs to the JD's own job").toBe(jobId);
  expect(mine.devCaseId, "the entry points back at the assignment").toBe(caseId);
  // A real profiles row, not a "ds-<submissionId>" identity that Matrix/Match
  // could never rank.
  expect(mine.candidateId).toBeTruthy();
  expect(mine.candidateId.startsWith("ds-"), "the candidate id must be a profile, not a minted submission id").toBe(false);
  expect(entries.filter((e) => e.candidateId === mine.candidateId), "one person, one row on this role").toHaveLength(1);

  // SEAM 3 — a transfer score is not a match score. It stays off match_score
  // entirely (devcase-run.ts's createPipelineEntry passes matchScore: null) and
  // arrives as its own field.
  expect(mine.matchScore, "a work sample must not be written into the match score").toBeNull();
  expect(typeof mine.transferScore, "the transfer score reaches the board as itself").toBe("number");

  // …and the board SAYS so. The kind marker only renders on a non-match score
  // (PipelineCandidateRow.tsx:248-252); its title is the sentence that tells a
  // recruiter which of the four 0-100 numbers they are looking at.
  await page.goto(`/?tab=pipeline&q=${encodeURIComponent(CANDIDATE)}`);
  const row = page.getByRole("button", { name: CANDIDATE }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTitle(/A work-sample transfer score, not a match score/).first()).toBeVisible();
});

test("the voice screen is offered from the assignment, on the same entry", async ({ page }) => {
  test.setTimeout(180_000);
  // SEAM 4 — reachable from the SUBMISSION. Before this, a voice screen could
  // only be minted for a board entry, so an assignment candidate had to be
  // promoted and then hunted down on the board first.
  await page.goto("/?tab=assignments");
  await page.getByRole("button", { name: new RegExp(escapeRe(ROLE_TITLE)) }).first().click();
  // The panel renders under the evaluated submission only (DevSubmissionRow.tsx:205).
  await expect(page.getByText("Voice screen").first()).toBeVisible({ timeout: 30_000 });
  // The side effect is disclosed, not silent.
  await expect(page.getByText(/also puts this candidate on the Overview board/)).toBeVisible();

  const created = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/interview/create" && r.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Create link" }).first().click();
  const minted = await created;
  expect(minted.ok(), `POST /api/interview/create responded ${minted.status()}`).toBe(true);
  const session = (await minted.json()) as { token: string; entryId: string; configured: boolean };
  expect(session.token, "a voice screen mints a candidate token").toBeTruthy();
  // The SAME entry the promote made — the seam, asserted.
  expect(session.entryId, "the screen attaches to the entry the assignment already made").toBe(entryId);

  // And the reverse read resolves from the submission with no entry id in hand.
  const byEntry = await page.request.get(`/api/interview/by-entry?submission=${submissionId}`);
  expect(byEntry.ok()).toBe(true);
  const back = (await byEntry.json()) as { session: { token: string; jobId: string } | null; entryId: string | null };
  expect(back.entryId).toBe(entryId);
  expect(back.session?.token).toBe(session.token);
  // The interview is grounded on the JD's job, not on a synthetic devcase job.
  expect(back.session?.jobId).toBe(jobId);
});

test("a human seals the decision, and it is in the queue and in the chain", async ({ page }) => {
  test.setTimeout(180_000);
  // SEAM 5 — the promote wrote a `screening_review` approval, so the candidate is
  // waiting in the Decisions queue with the AI's recommendation attached.
  // Data first: the promote left a screening review open on THIS entry.
  const queued = await page.request.get("/api/pipeline");
  expect(queued.ok()).toBe(true);
  const waiting = ((await queued.json()) as { entries: Array<{ id: string; approvalKind: string | null }> }).entries.find(
    (e) => e.id === entryId
  );
  expect(waiting?.approvalKind, "promote must queue the candidate for a human screening decision").toBe(
    "screening_review"
  );

  await page.goto("/?tab=decisions");
  await expect(page.getByText("Your decision queue")).toBeVisible({ timeout: 30_000 });
  // Scoped to the ONE card (DecisionsAiReviewCard renders an <article>), so the
  // tag and the actions are asserted on this candidate's card and not merely
  // somewhere on a queue that holds other people's.
  const card = page.getByRole("article").filter({ hasText: CANDIDATE });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("AI screening")).toBeVisible();
  await expect(card.getByRole("button", { name: "Reject" })).toBeVisible();

  // Seal it. Reject rather than Advance: advancing a scorecard-reviewed entry can
  // route to a human interview round instead of sealing (pipeline-entry-action.ts),
  // and this step is about the SEAL, not about the routing.
  const sealed = await page.request.post(`/api/pipeline/${entryId}`, {
    data: { action: "reject", detail: `e2e one-thread ${runId}: sealed by the journey` },
  });
  expect(sealed.ok(), `POST /api/pipeline/[id] responded ${sealed.status()}`).toBe(true);

  const records = await page.request.get(`/api/decisions/records?candidate=${entryId}`);
  expect(records.ok(), `GET /api/decisions/records responded ${records.status()}`).toBe(true);
  const audit = (await records.json()) as {
    records: Array<{ kind: string; actor: string; candidateRef: string; rationale: string; reasonCode: string }>;
    chain: { ok: boolean; count: number; keyed: boolean; brokenAtSeq: number | null };
  };
  expect(audit.records, "the decision on this candidate is sealed, once").toHaveLength(1);
  const record = audit.records[0];
  expect(record.kind).toBe("rejected");
  expect(record.candidateRef).toBe(entryId);
  expect(record.reasonCode).toBe("reject");
  expect(record.rationale, "the recruiter's own words reach the record").toContain(runId);
  // A HUMAN, named as one — the AI-Act claim the landing page makes. (`actor` is
  // `human:<role>`; without KP_OPERATOR_NAME the name half is a placeholder, which
  // is a known and separately-tracked gap — the KIND of actor is what is pinned.)
  expect(record.actor.startsWith("human:"), `a human must own the decision, got ${record.actor}`).toBe(true);
  // The chain verifies. Keyless it is integrity-evident rather than
  // tamper-resistant, and the panel says exactly that — either way it must not be
  // BROKEN, which is the only outcome that means a sealed record was altered.
  expect(audit.chain.brokenAtSeq, "the decision chain must be unbroken").toBeNull();
  expect(audit.chain.ok).toBe(true);

  // And the recruiter can SEE the seal: the sealed-record ledger lives in
  // Analytics → Quality & audit, not in the Decisions tab.
  await page.goto("/?tab=analytics&sec=quality");
  await expect(page.getByText("Decision records (sealed)")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/sealed records, chain verified/)).toBeVisible({ timeout: 30_000 });

  // Finally, the queue reflects the decision — the card that was waiting is gone.
  await page.goto("/?tab=decisions");
  await expect(page.getByText("Your decision queue")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(CANDIDATE)).toHaveCount(0);
});

type BoardEntry = {
  id: string;
  candidateId: string;
  candidateLabel: string;
  jobId: string;
  stage: string;
  matchScore: number | null;
  transferScore: number | null;
  devCaseId: string | null;
  devSubmissionId: string | null;
};

/** Escape a run-scoped title for use inside a RegExp accessible-name matcher. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
