// Pins the session rescore door (challenge-r10 interview-execution-scoring/B).
//
// A completed candidate interview that failed scoring can be re-scored by an operator
// through POST /api/interview/sessions/[id]/rescore. This route:
//   1. checks requireOperator & pipeline:write capability
//   2. scopes to currentWorkspace (foreign id -> 404)
//   3. gates on interviewScoringState === "unscored" (already scored, grace window, mode test -> 409)
//   4. commits through interview-scorecard-commit with requireUnscored: true
//   5. if a race sets scorecard_json during the scoring await, the CAS fails -> 409
//
// unit-db.ts MUST stay the first project import.
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";

const { POST } = await import("./route.ts");
const { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } = await import("@/app/_lib/db/pipeline.ts");
const { createInterviewSession, completeInterviewSession, getInterviewSessionById, markInterviewStarted, attachInterviewScorecard } = await import("@/app/_lib/db/interviews.ts");
const { ensureDb } = await import("@/app/_lib/db/core.ts");
const { DEFAULT_WORKSPACE_ID } = await import("@/app/_lib/db/workspaces.ts");
const { listDecisionRecords } = await import("@/app/_lib/decision-record-store.ts");
const { AUTOMATION_VERSION } = await import("@/app/_lib/automation-run.ts");
const { PUBLIC_API_EXACT } = await import("@/app/_lib/auth/public-routes.ts");

after(() => {
  delete process.env.PYTHON_CMD;
  cleanupUnitDb();
});

const WS = DEFAULT_WORKSPACE_ID;
const TRANSCRIPT = [
  { role: "interviewer" as const, text: "How do you test race conditions?" },
  { role: "candidate" as const, text: "Using isolated transactional CAS checks." },
];

let seq = 0;
function makeUnscoredSession(overrides?: {
  endedAt?: string;
  mode?: "candidate" | "test";
  scorecard?: unknown;
  workspaceId?: string;
}) {
  seq += 1;
  const ws = overrides?.workspaceId ?? WS;
  const { entry } = createPipelineEntry({
    candidateId: `cand-rescore-${seq}`,
    candidateLabel: `Rescore Candidate ${seq}`,
    jobId: `job-rescore-${seq}`,
    jobTitle: "Platform Engineer",
    stage: "Interview",
    workspaceId: ws,
  });

  const session = createInterviewSession({
    provider: "openai",
    mode: overrides?.mode ?? "candidate",
    entryId: entry.id,
    jobTitle: "Platform Engineer",
    durationMin: 15,
    workspaceId: ws,
  });

  markInterviewStarted(session.id, true);
  completeInterviewSession(session.id, {
    transcript: TRANSCRIPT,
    scorecard: overrides?.scorecard,
  });
  const endedAt = overrides?.endedAt ?? new Date(Date.now() - 10 * 60 * 1000).toISOString();
  ensureDb().prepare("UPDATE interview_sessions SET ended_at = ? WHERE id = ?").run(endedAt, session.id);

  return { entry, session: getInterviewSessionById(session.id)! };
}

function stubScore(during?: () => void) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    during?.();
    return {
      scorecard: { recommendation: "advance", summary: "rescore stub", ratings: [{ key: "technical", rating: 4, evidence: "I built a test harness." }], coverage: { keptTurns: 2, totalTurns: 2, droppedTurns: 0 } },
      provenance: { verdictSource: "llm" as const, verdictProvider: "claude_cli" },
      actor: "auto:automation-llm",
      recommendation: "advance",
      version: AUTOMATION_VERSION.scorecard,
    };
  };
  return { fn, calls: () => calls };
}

const req = (id: string) =>
  new NextRequest(`http://localhost/api/interview/sessions/${id}/rescore`, {
    method: "POST",
  });

test("a degraded rescore answers INTERVIEW_SCORECARD_UNGROUNDED and leaves the session unscored", async () => {
  const { entry, session } = makeUnscoredSession();
  const degraded = async () => ({
    scorecard: { recommendation: "hold", summary: "d", ratings: [{ key: "technical", rating: 3, evidence: "Not assessed — no evidence." }] },
    provenance: { verdictSource: "deterministic" as const, verdictProvider: null },
    version: AUTOMATION_VERSION.scorecard,
  });
  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: degraded as never } });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "INTERVIEW_SCORECARD_UNGROUNDED");
  assert.equal(getInterviewSessionById(session.id)!.scorecard ?? null, null);
  assert.equal(getPipelineEntry(entry.id, WS)!.approvalKind ?? null, null);
});

test("acceptance 114: rescore route on unscored session -> 200, scorecard attached, approval set, sealed", async () => {
  const { entry, session } = makeUnscoredSession();
  const scorer = stubScore();

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 200);

  const body = (await res.json()) as { ok: boolean; session: { scorecard?: unknown }; gate: string };
  assert.equal(body.ok, true);
  assert.equal(body.gate, "opened");
  assert.equal(scorer.calls(), 1);

  const stored = getInterviewSessionById(session.id)!;
  assert.ok(stored.scorecard, "session scorecard_json is set");

  const fresh = getPipelineEntry(entry.id, WS)!;
  assert.equal(fresh.approvalKind, "scorecard_review", "entry approval is scorecard_review");

  const events = listPipelineEventsForEntry(entry.id, 100, WS).filter((e) => e.kind === "interview_scorecard");
  assert.equal(events.length, 1, "exactly one interview_scorecard event");

  const seals = listDecisionRecords({ candidateRef: entry.id, workspaceId: WS }).filter((d) => d.kind === "ai_scorecard");
  assert.equal(seals.length, 1, "exactly one ai_scorecard record sealed");
});

test("acceptance 115: already scored session -> 409 INTERVIEW_NOT_RESCORABLE and scorer not called", async () => {
  const { session } = makeUnscoredSession({
    scorecard: { recommendation: "hold" },
  });
  const scorer = stubScore();

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 409);

  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INTERVIEW_NOT_RESCORABLE");
  assert.equal(scorer.calls(), 0, "scorer stub is never called");
});

test("acceptance 115: session inside grace window -> 409 INTERVIEW_NOT_RESCORABLE and scorer not called", async () => {
  const { session } = makeUnscoredSession({
    endedAt: new Date(Date.now() - 60 * 1000).toISOString(), // 60s ago < 5 min grace
  });
  const scorer = stubScore();

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 409);

  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INTERVIEW_NOT_RESCORABLE");
  assert.equal(scorer.calls(), 0, "scorer stub is never called");
});

test("acceptance 115: session with mode 'test' -> 409 INTERVIEW_NOT_RESCORABLE and scorer not called", async () => {
  const { session } = makeUnscoredSession({
    mode: "test",
  });
  const scorer = stubScore();

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 409);

  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INTERVIEW_NOT_RESCORABLE");
  assert.equal(scorer.calls(), 0, "scorer stub is never called");
});

test("acceptance 115: foreign workspace session id -> 404 INTERVIEW_SESSION_NOT_FOUND", async () => {
  const { session } = makeUnscoredSession({
    workspaceId: "other-workspace-id",
  });
  const scorer = stubScore();

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 404);

  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INTERVIEW_SESSION_NOT_FOUND");
  assert.equal(scorer.calls(), 0);
});

test("acceptance 116: rescore race -> original completion sets scorecard during await -> 409 INTERVIEW_NOT_RESCORABLE", async () => {
  const { entry, session } = makeUnscoredSession();
  const scorer = stubScore(() => {
    // Simulate original completion landing right in the middle of scoring await
    attachInterviewScorecard(session.id, {
      recommendation: "hold",
      original: true,
    });
  });

  const res = await POST(req(session.id), { params: Promise.resolve({ id: session.id }) }, { scoringDeps: { score: scorer.fn } });
  assert.equal(res.status, 409);

  const body = (await res.json()) as { code: string };
  assert.equal(body.code, "INTERVIEW_NOT_RESCORABLE");

  // No second approval, event, or seal from the rescore
  const stored = getInterviewSessionById(session.id)!;
  assert.deepEqual(stored.scorecard, { recommendation: "hold", original: true });

  const fresh = getPipelineEntry(entry.id, WS)!;
  assert.notEqual(fresh.approvalKind, "scorecard_review", "approval was not overwritten");

  const events = listPipelineEventsForEntry(entry.id, 100, WS).filter((e) => e.kind === "interview_scorecard");
  assert.equal(events.length, 0);

  const seals = listDecisionRecords({ candidateRef: entry.id, workspaceId: WS }).filter((d) => d.kind === "ai_scorecard");
  assert.equal(seals.length, 0);
});

test("acceptance 117: rescore route is not in public-routes", () => {
  assert.ok(!PUBLIC_API_EXACT.has("/api/interview/sessions/[id]/rescore"));
  assert.ok(!PUBLIC_API_EXACT.has("/api/interview/sessions"));
});
