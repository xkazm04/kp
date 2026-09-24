// THE CANDIDATE GUARD on /api/interview/complete (spark interview-kit-template, WP-D).
//
// The completion door used to synthesize a scorecard, set the scorecard_review approval
// and seal an ai_scorecard decision on `session.entryId && status === "completed"` —
// with NO mode check. A recruiter's kit rehearsal is a `mode: "test"` session, so a
// rehearsal that ever carried an entry would have scored the recruiter's OWN voice
// against a real candidate, opened that candidate's Interview→Offer gate on it, and
// sealed the verdict in their decision record. The rule now is: only a CANDIDATE
// INTERVIEW (candidate mode AND an entry) is ever scored — interview-rehearsal.ts.
//
// NON-VACUITY is the whole design of this file. "No scorecard" is also what an entry
// with no candidate profile, or a keyless install, produces — so asserting absence alone
// would pass with the guard deleted. Instead each entry below is made SCOREABLE: a real
// candidate profile, and the scorecard verdict seeded in the prompt cache at the exact
// key runAutomationTask computes (the reasoning-cache-first / automation-run idiom; a
// bogus PYTHON_CMD makes any miss fail fast instead of spawning). The control proves
// that a candidate-mode session on such an entry DOES get a scorecard, an approval and a
// sealed decision; the guarded case, on an identically scoreable entry, gets none.
//
// It also pins the BILLING decision for a rehearsal: metered like any call (the debit and
// the llm_usage cost row), attributed to the session id and to no candidate.
//
// unit-db.ts MUST stay the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";
for (const k of ["ELEVENLABS_BASE_URL", "OPENAI_REALTIME_MODEL"]) delete process.env[k];

const { POST } = await import("./route.ts");
const { ensureDb } = await import("../../../_lib/db/core.ts");
const { saveProfile, getProfileRecord } = await import("../../../_lib/db/profiles.ts");
const { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } = await import("../../../_lib/db/pipeline.ts");
const { createInterviewSession, getInterviewSessionById, markInterviewStarted } = await import("../../../_lib/db/interviews.ts");
const { interviewKitAppendVersion } = await import("../../../_lib/db/interview-kits.ts");
const { DEFAULT_WORKSPACE_ID, getWorkspaceDefaultLocale } = await import("../../../_lib/db/workspaces.ts");
const { storePromptCache } = await import("../../../_lib/db/analyses.ts");
const { computeAutomationCacheKey } = await import("../../../_lib/automation-cache-key.ts");
const { AUTOMATION_VERSION } = await import("../../../_lib/automation-run.ts");
const { meterAllows } = await import("../../../_lib/billing/enforce.ts");
const { buildScorecardNotes, clampTurn } = await import("../../../_lib/interview-transcript.ts");
const { listDecisionRecords } = await import("../../../_lib/decision-record-store.ts");
const { upsertBillingState, billingUsageFor } = await import("../../../_lib/db/billing.ts");
const { currentPeriod } = await import("../../../_lib/billing/plans.ts");

after(() => {
  delete process.env.PYTHON_CMD;
  cleanupUnitDb();
});

// The default org on a real, metered plan: the debit below then lands on a ledger the
// test can read, and ai_candidates stays allowed so the seeded key is the LLM one.
upsertBillingState({ plan: "growth", status: "active", provider: "polar", currentPeriodEnd: "2999-12-31T00:00:00Z" });

const WS = DEFAULT_WORKSPACE_ID;
const TRANSCRIPT = [
  { role: "interviewer", text: "How do you decide what to automate first?" },
  { role: "candidate", text: "By risk and by how often the path changes." },
];
const VERDICT = { recommendation: "advance", summary: "Seeded verdict — the model hop is skipped." };

let seq = 0;
/** A pipeline entry the scorecard path CAN score: a real profile, and the scorecard
 *  verdict for exactly this transcript seeded at the key runAutomationTask computes. */
function scoreableEntry() {
  seq += 1;
  const { id: candidateId } = saveProfile(
    { label: `Guard ${seq}`, archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["qa"] } },
    WS
  );
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Guard ${seq}`,
    jobId: `job-guard-${seq}`,
    jobTitle: "QA Engineer",
    workspaceId: WS,
  });
  const key = computeAutomationCacheKey({
    version: AUTOMATION_VERSION.scorecard,
    task: "scorecard",
    candidateId,
    profileJson: JSON.stringify(getProfileRecord(candidateId, WS)?.payload),
    jobId: entry.jobId ?? null,
    stage: entry.stage,
    // The notes the door will hand the scorer: the clamped transcript, flattened.
    notes: buildScorecardNotes(TRANSCRIPT.map((t) => clampTurn(t).turn)).notes,
    // runInterviewScorecard passes no lang, so the ENTRY's team default is the axis.
    lang: getWorkspaceDefaultLocale(entry.workspaceId),
    degraded: !meterAllows("ai_candidates", { workspace: WS }),
  });
  storePromptCache(key, { result: VERDICT, source: "llm" }, AUTOMATION_VERSION.scorecard, 168);
  return entry;
}

function complete(token: string) {
  return POST(
    new NextRequest("http://localhost/api/interview/complete", {
      method: "POST",
      body: JSON.stringify({ token, transcript: TRANSCRIPT }),
      headers: { "content-type": "application/json" },
    })
  );
}

const decisionsFor = (entryId: string) => listDecisionRecords({ candidateRef: entryId, workspaceId: WS });
const minutesUsed = () => billingUsageFor("interview_minutes", currentPeriod());

// ---- the control: a candidate interview on a scoreable entry IS scored ----------------

test("CONTROL — a candidate-mode session on a scoreable entry gets the scorecard, the approval and the sealed decision", async () => {
  const entry = scoreableEntry();
  const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, jobTitle: "QA Engineer", durationMin: 8 });
  markInterviewStarted(session.id, true);

  const res = await complete(session.token);
  assert.equal(res.status, 200);
  assert.ok(getInterviewSessionById(session.id)?.scorecard, "the scorecard is attached to the session");
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind, "scorecard_review", "the Interview→Offer approval is set");
  assert.ok(
    decisionsFor(entry.id).some((d) => d.kind === "ai_scorecard"),
    "the AI verdict is sealed in the candidate's decision record"
  );
});

// ---- the guard ------------------------------------------------------------------------

test("a TEST-mode session carrying an entryId completes, keeps its transcript — and scores, approves and seals NOTHING", async () => {
  const entry = scoreableEntry();
  const entryBefore = getPipelineEntry(entry.id, WS);
  const eventsBefore = listPipelineEventsForEntry(entry.id, 50, WS).length;
  // The shape the guard exists for: a rehearsal (test mode, a pinned kit) that somehow
  // carries a real candidate's entry.
  const kitId = interviewKitAppendVersion(
    {
      jobId: entry.jobId ?? "job-guard",
      kit: { version: 1, competencies: [{ id: "c", title: "Ownership", weight: 2, budgetMin: 5, questions: [{ id: "q", text: "Q?", mustAsk: false }] }], faq: [] },
      source: "edited",
    },
    WS
  ).id;
  const session = createInterviewSession({
    provider: "openai",
    mode: "test",
    entryId: entry.id,
    jobId: entry.jobId,
    jobTitle: "QA Engineer",
    durationMin: 8,
    kitId,
  });
  markInterviewStarted(session.id, false);

  const res = await complete(session.token);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; session: { status: string; transcript: unknown[] | null } };
  assert.equal(body.ok, true, "the completion itself succeeds");
  assert.equal(body.session.status, "completed");
  assert.equal(body.session.transcript?.length, TRANSCRIPT.length, "what was said is kept");

  const stored = getInterviewSessionById(session.id);
  assert.equal(stored?.scorecard ?? null, null, "NO scorecard — the recruiter's voice is never scored");
  assert.deepEqual(getPipelineEntry(entry.id, WS), entryBefore, "the pipeline entry is untouched: no approval, no stage, nothing");
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind ?? null, null, "no scorecard_review approval");
  assert.deepEqual(decisionsFor(entry.id), [], "no decision is sealed against the candidate");
  assert.equal(listPipelineEventsForEntry(entry.id, 50, WS).length, eventsBefore, "no event lands on the candidate's timeline");
});

// ---- the billing decision ---------------------------------------------------------------

test("a REHEARSAL is metered like any call — the minutes debit and the cost row — and attributed to no candidate", async () => {
  const kitId = interviewKitAppendVersion(
    {
      jobId: "job-guard-rehearsal",
      kit: { version: 1, competencies: [{ id: "c", title: "Ownership", weight: 2, budgetMin: 5, questions: [{ id: "q", text: "Q?", mustAsk: false }] }], faq: [] },
      source: "edited",
    },
    WS
  ).id;
  const session = createInterviewSession({
    provider: "openai",
    mode: "test",
    jobId: "job-guard-rehearsal",
    jobTitle: "QA Engineer",
    durationMin: 20,
    workspaceId: WS,
    kitId,
  });
  markInterviewStarted(session.id, false);
  const before = minutesUsed();

  const res = await complete(session.token);
  assert.equal(res.status, 200);
  assert.equal(minutesUsed() - before, 1, "the completed call debits its (floor-clamped) minute on the workspace's meter");

  const rows = ensureDb().prepare(`SELECT use_case, provider, request_id FROM llm_usage WHERE request_id = ?`).all(session.id) as {
    use_case: string;
    provider: string;
    request_id: string;
  }[];
  assert.equal(rows.length, 1, "exactly one cost row for the call");
  assert.equal(rows[0].use_case, "interview_realtime");
  assert.equal(rows[0].provider, "openai");
  // The row's ONLY link back is the session id — and that session names no candidate.
  assert.equal(getInterviewSessionById(session.id)?.entryId, null, "the priced session carries no entry");
  assert.equal(getInterviewSessionById(session.id)?.scorecard ?? null, null);
});
