// The voice-interview verdict commits ONCE (challenge-r10 interview-execution-scoring/A).
//
// The AI scorecard used to be written as five effects in the wrong order: the
// scorecard_review APPROVAL and the `interview_scorecard` event first (inside
// runAutomationTask), then the enrichments stamped onto an object the approval had
// already stringified, then a conditional attach to the session, then the seal. So a
// refused attach (erasure / revoke during the scoring await) still opened the
// Interview->Offer gate, a human scorecard saved during the hop was overwritten, and
// the Decisions card ratified a payload without the coverage/telemetry the session
// stores. These cases pin the new order: score (no writes) -> ONE locked unit on the
// core connection (attach -> gate re-read -> approval CAS -> event) -> seal on the
// ledger's own connection -> mint only for an attached scorecard.
//
// unit-db.ts MUST stay the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";

const { finalizeCandidateInterviewScoring, scorecardGateOpen } = await import("./interview-scorecard-commit.ts");
const { runAutomationTask, AUTOMATION_VERSION } = await import("./automation-run.ts");
const { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval, actOnPipelineEntry, setPipelineEntryStage, anonymizeEntry } =
  await import("./db/pipeline.ts");
const { createInterviewSession, completeInterviewSession, getInterviewSessionById, markInterviewStarted } = await import("./db/interviews.ts");
const { DEFAULT_WORKSPACE_ID, getWorkspaceDefaultLocale } = await import("./db/workspaces.ts");
const { listDecisionRecords } = await import("./decision-record-store.ts");
const { saveProfile, getProfileRecord } = await import("./db/profiles.ts");
const { storePromptCache } = await import("./db/analyses.ts");
const { computeAutomationCacheKey } = await import("./automation-cache-key.ts");
const { meterAllows } = await import("./billing/enforce.ts");
const { DEFAULT_STAGE_AXIS } = await import("./pipeline-stages.ts");

after(() => {
  delete process.env.PYTHON_CMD;
  cleanupUnitDb();
});

const WS = DEFAULT_WORKSPACE_ID;
const TRANSCRIPT = [
  { role: "interviewer" as const, text: "How do you decide what to automate first?" },
  { role: "candidate" as const, text: "By risk and by how often the path changes." },
];

let seq = 0;
/** An active entry at the interview-role stage with no approval, and a COMPLETED
 *  candidate session holding a transcript — the shape /complete scores. */
function interviewedEntry() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cand-commit-${seq}`,
    candidateLabel: `Commit ${seq}`,
    jobId: `job-commit-${seq}`,
    jobTitle: "QA Engineer",
    stage: "Interview",
    workspaceId: WS,
  });
  const session = createInterviewSession({ provider: "openai", mode: "candidate", entryId: entry.id, jobTitle: "QA Engineer", durationMin: 8 });
  markInterviewStarted(session.id, true);
  completeInterviewSession(session.id, { transcript: TRANSCRIPT });
  return { entry, session: getInterviewSessionById(session.id)! };
}

const COVERAGE = { keptTurns: 2, totalTurns: 40, droppedTurns: 38 };
const TELEMETRY = { talkRatio: 0.4, hintUptake: null };

/** A scorer stub: the enriched scorecard + provenance, no writes — plus an optional
 *  side effect that plays the race landing DURING the await. */
function stubScore(during?: () => void) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    during?.();
    return {
      scorecard: { recommendation: "advance", summary: "stubbed", ratings: [], coverage: COVERAGE, telemetry: TELEMETRY },
      provenance: { verdictSource: "llm" as const, verdictProvider: "claude_cli" },
      actor: "auto:automation-llm",
      recommendation: "advance",
      version: AUTOMATION_VERSION.scorecard,
    };
  };
  return { fn, calls: () => calls };
}

function stubMint(credited: string[] = []) {
  const seen: Record<string, unknown>[] = [];
  const fn = async (_entryId: string, scorecard: Record<string, unknown>) => {
    seen.push(scorecard);
    return { credited };
  };
  return { fn, seen };
}

const aiEvents = (entryId: string) =>
  listPipelineEventsForEntry(entryId, 100, WS).filter((e) => e.kind === "interview_scorecard");
const aiSeals = (entryId: string) => listDecisionRecords({ candidateRef: entryId, workspaceId: WS }).filter((d) => d.kind === "ai_scorecard");

// ---- case 1 -------------------------------------------------------------------------

test("an attached scorecard opens the gate once, records one event, seals once — and the approval IS the enriched scorecard", async () => {
  const { entry, session } = interviewedEntry();
  const score = stubScore();
  const mint = stubMint();
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: score.fn, mint: mint.fn });

  assert.equal(res.attached, true);
  assert.equal(res.gate, "opened");
  const stored = getInterviewSessionById(session.id)!;
  assert.ok(stored.scorecard, "scorecard_json attached");
  const fresh = getPipelineEntry(entry.id, WS)!;
  assert.equal(fresh.approvalKind, "scorecard_review");
  assert.equal(aiEvents(entry.id).length, 1, "exactly one interview_scorecard event");
  assert.equal(aiSeals(entry.id).length, 1, "exactly one ai_scorecard record");
  const detail = JSON.parse(fresh.approvalDetail ?? "{}");
  const sc = stored.scorecard as Record<string, unknown>;
  assert.deepEqual(detail.coverage, sc.coverage, "the ratified payload carries the coverage the session stores");
  assert.deepEqual(detail.telemetry, sc.telemetry, "…and the telemetry");
  assert.equal(detail.verdictSource, "llm", "provenance still rides the approval");
});

// ---- case 2 -------------------------------------------------------------------------

test("an erasure during the scoring await: nothing attaches, the gate stays shut, no event, no seal, no mint", async () => {
  const { entry, session } = interviewedEntry();
  const score = stubScore(() => {
    anonymizeEntry(entry.id, "erasure", WS);
  });
  const mint = stubMint(["sql"]);
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: score.fn, mint: mint.fn });

  assert.equal(res.attached, false);
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind ?? null, null, "no scorecard_review approval");
  assert.equal(aiEvents(entry.id).length, 0, "no interview_scorecard event");
  assert.equal(aiSeals(entry.id).length, 0, "no ai_scorecard record");
  assert.equal(mint.seen.length, 0, "the observed-skill mint never runs for an unrecorded interview");
});

// ---- case 3 -------------------------------------------------------------------------

test("a HUMAN scorecard saved during the await holds the gate: the AI verdict is recorded and sealed, the human approval stands", async () => {
  const { entry, session } = interviewedEntry();
  const human = JSON.stringify({ source: "human", recommendation: "hold", ratings: [] });
  const score = stubScore(() => {
    setApproval(entry.id, "scorecard_review", human, WS);
  });
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: score.fn, mint: stubMint().fn });

  assert.equal(res.attached, true);
  assert.equal(res.gate, "held");
  assert.ok(getInterviewSessionById(session.id)?.scorecard, "the AI scorecard is on the session");
  assert.equal(aiSeals(entry.id).length, 1, "and sealed");
  const fresh = getPipelineEntry(entry.id, WS)!;
  assert.equal(fresh.approvalKind, "scorecard_review");
  assert.equal(JSON.parse(fresh.approvalDetail ?? "{}").source, "human", "the human verdict is what Decisions ratifies");
  assert.equal(aiEvents(entry.id).length, 0, "no AI interview_scorecard event claims the gate");
});

// ---- case 4 -------------------------------------------------------------------------

test("an entry rejected during the await: the call is on record, the gate is closed", async () => {
  const { entry, session } = interviewedEntry();
  const score = stubScore(() => {
    actOnPipelineEntry(entry.id, "reject", undefined, { actor: "human" }, WS);
  });
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: score.fn, mint: stubMint().fn });

  assert.equal(res.attached, true);
  assert.equal(res.gate, "closed");
  assert.ok(getInterviewSessionById(session.id)?.scorecard);
  assert.notEqual(getPipelineEntry(entry.id, WS)?.approvalKind, "scorecard_review");
  assert.equal(aiEvents(entry.id).length, 0);
});

test("an entry moved off the interview-role stage during the await: gate closed, no approval", async () => {
  const { entry, session } = interviewedEntry();
  const score = stubScore(() => {
    setPipelineEntryStage(entry.id, "Offer", {}, WS);
  });
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: score.fn, mint: stubMint().fn });

  assert.equal(res.attached, true);
  assert.equal(res.gate, "closed");
  assert.notEqual(getPipelineEntry(entry.id, WS)?.approvalKind, "scorecard_review");
});

// ---- case 5 -------------------------------------------------------------------------

test("credited observed skills are re-attached to the session (and the approval) after an applied attach", async () => {
  const { entry, session } = interviewedEntry();
  const mint = stubMint(["sql", "testing"]);
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: stubScore().fn, mint: mint.fn });

  assert.equal(res.attached, true);
  assert.equal(mint.seen.length, 1, "the mint runs once, for the attached scorecard");
  const sc = getInterviewSessionById(session.id)?.scorecard as Record<string, unknown>;
  assert.deepEqual(sc.observedSkills, ["sql", "testing"]);
  assert.deepEqual(JSON.parse(getPipelineEntry(entry.id, WS)?.approvalDetail ?? "{}").observedSkills, ["sql", "testing"]);
});

test("a custom attach (the re-score door's requireUnscored binding) is the one consulted", async () => {
  const { entry, session } = interviewedEntry();
  const refused = () => ({ applied: false, session: getInterviewSessionById(session.id) });
  const mint = stubMint(["sql"]);
  const res = await finalizeCandidateInterviewScoring(session, TRANSCRIPT, { score: stubScore().fn, mint: mint.fn, attach: refused });
  assert.equal(res.attached, false);
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind ?? null, null);
  assert.equal(aiSeals(entry.id).length, 0);
  assert.equal(mint.seen.length, 0);
});

// ---- case 6: the manual drawer path ---------------------------------------------------

const NOTE = "Strong on test strategy; vague on CI ownership.";
function scoreableInterviewEntry() {
  seq += 1;
  const { id: candidateId } = saveProfile(
    { label: `Manual ${seq}`, archetype: "bau", roleFamily: "software_engineering", completeness: 90, payload: { skills: ["qa"] } },
    WS
  );
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Manual ${seq}`,
    jobId: `job-manual-${seq}`,
    jobTitle: "QA Engineer",
    stage: "Interview",
    workspaceId: WS,
  });
  const key = computeAutomationCacheKey({
    version: AUTOMATION_VERSION.scorecard,
    task: "scorecard",
    candidateId,
    profileJson: JSON.stringify(getProfileRecord(candidateId, WS)?.payload),
    jobId: entry.jobId ?? null,
    stage: entry.stage,
    notes: NOTE,
    lang: getWorkspaceDefaultLocale(entry.workspaceId),
    degraded: !meterAllows("ai_candidates", { workspace: WS }),
  });
  storePromptCache(key, { result: { recommendation: "advance", summary: "seeded" }, source: "llm" }, AUTOMATION_VERSION.scorecard, 168);
  return entry;
}

test("manual Synthesize scorecard on an entry already at offer_review is refused, not overwritten", async () => {
  const entry = scoreableInterviewEntry();
  setApproval(entry.id, "offer_review", JSON.stringify({ recommended: 100 }), WS);
  const out = await runAutomationTask(entry.id, "scorecard", NOTE, undefined, undefined, WS, { manual: true });
  assert.equal(out.applied, "skipped_gate_closed");
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind, "offer_review");
  assert.equal(aiEvents(entry.id).length, 0);
});

test("manual Synthesize scorecard on an open interview gate still raises scorecard_review exactly as before", async () => {
  const entry = scoreableInterviewEntry();
  const out = await runAutomationTask(entry.id, "scorecard", NOTE, undefined, undefined, WS, { manual: true });
  assert.equal(out.applied, "scorecard_ready");
  const fresh = getPipelineEntry(entry.id, WS)!;
  assert.equal(fresh.approvalKind, "scorecard_review");
  assert.equal(JSON.parse(fresh.approvalDetail ?? "{}").verdictSource, "llm");
  assert.equal(aiEvents(entry.id).length, 1);
});

test("deferApply scores and writes nothing", async () => {
  const entry = scoreableInterviewEntry();
  const before = listPipelineEventsForEntry(entry.id, 100, WS).length;
  const out = await runAutomationTask(entry.id, "scorecard", NOTE, undefined, undefined, WS, { deferApply: true });
  assert.equal(out.applied, "deferred");
  assert.equal(out.deferred?.provenance.verdictSource, "llm");
  assert.equal(out.deferred?.recommendation, "advance");
  assert.equal(getPipelineEntry(entry.id, WS)?.approvalKind ?? null, null);
  assert.equal(listPipelineEventsForEntry(entry.id, 100, WS).length, before);
});

test("scorecardGateOpen is the human door's rule: active, interview role, approval null|calendar", () => {
  const stages = DEFAULT_STAGE_AXIS;
  const base = { status: "active", stage: "Interview", approvalKind: null } as const;
  assert.equal(scorecardGateOpen(base, stages), true);
  assert.equal(scorecardGateOpen({ ...base, approvalKind: "calendar" }, stages), true);
  assert.equal(scorecardGateOpen({ ...base, approvalKind: "scorecard_review" }, stages), false);
  assert.equal(scorecardGateOpen({ ...base, approvalKind: "offer_review" }, stages), false);
  assert.equal(scorecardGateOpen({ ...base, stage: "Offer" }, stages), false);
  assert.equal(scorecardGateOpen({ ...base, status: "rejected" }, stages), false);
});

// ---- case 7: source pins ------------------------------------------------------------

test("the write half is synchronous and locked; the route no longer writes the verdict itself", () => {
  const src = readFileSync(new URL("./interview-scorecard-commit.ts", import.meta.url), "utf8");
  const commit = src.slice(src.indexOf("export function commitCandidateScorecard"), src.indexOf("export async function finalizeCandidateInterviewScoring"));
  assert.match(commit, /\.transaction\(/, "the commit is one transaction");
  assert.match(commit, /\.immediate\(\)/, "taken with the write lock at BEGIN");
  assert.doesNotMatch(commit, /\bawait\b/, "nothing awaits inside the commit");
  // Every transaction in the module is IMMEDIATE.
  assert.equal((src.match(/\.transaction\(/g) ?? []).length, (src.match(/\.immediate\(\)/g) ?? []).length);
  // The seal runs AFTER the commit returns (the ledger is on its own connection).
  const fin = src.slice(src.indexOf("export async function finalizeCandidateInterviewScoring"));
  assert.ok(fin.indexOf("commitCandidateScorecard(") > -1 && fin.indexOf("commitCandidateScorecard(") < fin.indexOf("seal("));
  const route = readFileSync(new URL("../api/interview/complete/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /attachInterviewScorecard/);
  assert.doesNotMatch(route, /sealDecisionSafe/);
  assert.match(route, /finalizeCandidateInterviewScoring\(session, transcript\)/);
});
