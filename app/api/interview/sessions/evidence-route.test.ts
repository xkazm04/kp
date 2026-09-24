// GET /api/interview/sessions/[id]/evidence — the recruiter's evidence door, driven
// through the REAL handler against an isolated DB.
//
// What it pins: the door answers the director's own record (agenda coverage, projected
// events, recording metadata), it is scoped to the caller's team the way its siblings
// are (a foreign or unknown id answers the SAME coded 404, so it is never an existence
// oracle), the projection carries no private brief material and no tool bookkeeping,
// the bound is stated on the wire, and an expired consent withholds every verbatim word
// while the structure survives.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { GET } from "./[id]/evidence/route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { appendInterviewEvents } from "../../../_lib/db/interview-events.ts";
import { createInterviewSession, markInterviewStarted } from "../../../_lib/db/interviews.ts";
import { createPipelineEntry } from "../../../_lib/db/pipeline.ts";
import { EVIDENCE_EVENT_LIMIT, type InterviewEvidence } from "../../../_lib/interview-evidence.ts";
import type { InterviewAgenda } from "../../../_lib/voice/director-types.ts";

after(() => cleanupUnitDb());

const PRIVATE_BRIEF = "Internal red flag — never say this aloud: claims 8 skills.";
const AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 30,
  hardCapMin: 36,
  closeReserveMin: 5,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: ["How are you?"] },
    { id: "b1", kind: "topic", title: "System design", budgetMin: 6, competency: "architecture-PRIVATE", scored: true, questions: ["PRIVATE-QUESTION-1"] },
    { id: "b2", kind: "topic", title: "Debugging", budgetMin: 6, competency: "debugging-PRIVATE", scored: true, questions: ["PRIVATE-QUESTION-2"] },
    { id: "b3", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ],
};

type Body = { evidence?: InterviewEvidence; code?: string; error?: string };

function get(id: string): Promise<Response> {
  return GET(new NextRequest(`http://localhost/api/interview/sessions/${id}/evidence`, { method: "GET" }), {
    params: Promise.resolve({ id }),
  });
}

/** A completed, directed candidate call in the caller's (default) workspace. */
function directedCall(opts: { workspaceId?: string; agenda?: InterviewAgenda | null } = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { entry } = createPipelineEntry({
    candidateId: `c-ev-${suffix}`,
    candidateLabel: "Evidence Candidate",
    jobId: `job-ev-${suffix}`,
    jobTitle: "Backend Engineer",
    stage: "Interview",
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
  });
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    entryId: entry.id,
    candidateLabel: "Evidence Candidate",
    jobTitle: "Backend Engineer",
    instructions: PRIVATE_BRIEF,
    durationMin: 30,
    ...(opts.workspaceId ? { workspaceId: opts.workspaceId } : {}),
  });
  assert.ok(markInterviewStarted(session.id, true));
  const agenda = opts.agenda === undefined ? AGENDA : opts.agenda;
  if (agenda) ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(agenda), session.id);
  return { entry, session };
}

const CANDIDATE_SAID = "Last year I rebuilt our payment reconciliation job so it runs incrementally.";

function recordAWholeCall(sessionId: string, workspaceId: string) {
  appendInterviewEvents(
    [
      { sessionId, attempt: 1, kind: "topic_begun", blockId: "b0" },
      { sessionId, attempt: 1, seq: 0, kind: "turn", blockId: "b0", payload: { role: "interviewer", text: "Good morning." } },
      { sessionId, attempt: 1, seq: 1, kind: "turn", blockId: "b0", payload: { role: "candidate", text: "Morning!" } },
      { sessionId, attempt: 1, kind: "topic_begun", blockId: "b1" },
      { sessionId, attempt: 1, seq: 2, kind: "turn", blockId: "b1", payload: { role: "candidate", text: CANDIDATE_SAID } },
      { sessionId, attempt: 1, kind: "topic_covered", blockId: "b1", payload: { quote: CANDIDATE_SAID, callId: "call_1", toolResult: "Recorded." } },
      { sessionId, attempt: 1, kind: "directive", blockId: "b2", payload: { kind: "move_on", directiveId: "dir-1", text: "[Director] Begin block b2 now." } },
      { sessionId, attempt: 1, kind: "guardrail", blockId: "b2", payload: { kind: "score_request", quote: "how did I do", verified: false, callId: "call_2" } },
      { sessionId, attempt: 1, kind: "candidate_question", blockId: "b3", payload: { question: "Is the team hybrid?" } },
      { sessionId, attempt: 1, kind: "focus_lost", blockId: "b2", payload: { during: "interviewer" } },
      { sessionId, attempt: 1, kind: "focus_returned", blockId: "b2", payload: { awayMs: 7_000 } },
      { sessionId, attempt: 1, kind: "answer_timing", blockId: "b1", payload: { turnSeq: 2, preSilenceMs: 1_400, durationMs: 42_000 } },
      { sessionId, attempt: 1, kind: "answer_timing", blockId: "b2", payload: { turnSeq: 3, preSilenceMs: null, durationMs: null } },
    ],
    workspaceId,
  );
}

test("the door answers the director's record: coverage, projected events, and the bound it used", async () => {
  const { session } = directedCall();
  recordAWholeCall(session.id, session.workspaceId);

  const res = await get(session.id);
  assert.equal(res.status, 200);
  const evidence = ((await res.json()) as Body).evidence!;

  assert.equal(evidence.sessionId, session.id);
  assert.equal(evidence.observed, true);
  assert.equal(evidence.timingSource, "speech_boundaries");
  assert.equal(evidence.limit, EVIDENCE_EVENT_LIMIT);
  assert.equal(evidence.truncated, false);

  const byId = Object.fromEntries(evidence.agenda!.blocks.map((b) => [b.id, b]));
  assert.equal(byId.b1.covered, true);
  assert.equal(byId.b2.covered, false);
  assert.equal(byId.b2.begun, false);
  assert.equal(byId.b0.scored, false, "the warm-up is not assessed");
  assert.equal(byId.b1.scored, true);

  const kinds = evidence.events.map((e) => e.kind);
  for (const kind of ["turn", "topic_begun", "topic_covered", "directive", "guardrail", "candidate_question", "focus_lost", "focus_returned", "answer_timing"]) {
    assert.ok(kinds.includes(kind as (typeof kinds)[number]), `${kind} reaches the recruiter`);
  }
  const guardrail = evidence.events.find((e) => e.kind === "guardrail")!;
  assert.equal(guardrail.guardrail, "score_request");
  assert.equal(guardrail.quote, "how did I do");
  assert.equal(guardrail.verified, false);
  assert.equal(guardrail.blockId, "b2");

  const timings = evidence.events.filter((e) => e.kind === "answer_timing");
  assert.equal(timings[0].preSilenceMs, 1_400);
  assert.equal(timings[1].preSilenceMs, null, "an unmeasurable pause stays null on the wire");
  assert.notEqual(timings[1].durationMs, 0);
});

test("no private brief material and no tool bookkeeping crosses the wire", async () => {
  const { session } = directedCall();
  recordAWholeCall(session.id, session.workspaceId);
  const wire = await (await get(session.id)).text();
  assert.equal(wire.includes("PRIVATE"), false, "no competency, no planned question");
  assert.equal(wire.includes("claims 8 skills"), false, "no brief");
  assert.equal(wire.includes("call_1"), false, "no callId");
  assert.equal(wire.includes("[Director]"), false, "no injected stage-direction text");
  assert.equal(wire.includes(session.token), false, "never the candidate's bearer token");
});

test("a foreign session and an unknown id answer the SAME coded 404", async () => {
  const { session } = directedCall({ workspaceId: `other-team-${Math.random().toString(36).slice(2, 8)}` });
  recordAWholeCall(session.id, session.workspaceId);

  for (const [what, res] of [
    ["another team's session", await get(session.id)],
    ["an id that names nothing", await get("iv-does-not-exist")],
  ] as const) {
    assert.equal(res.status, 404, what);
    assert.equal(((await res.json()) as Body).code, "INTERVIEW_SESSION_NOT_FOUND", what);
  }
});

test("an expired consent withholds every verbatim word and keeps the structure", async () => {
  const { entry, session } = directedCall();
  recordAWholeCall(session.id, session.workspaceId);
  const long = new Date(Date.now() - 400 * 86_400_000).toISOString();
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run(long, new Date(Date.now() - 86_400_000).toISOString(), entry.id);

  const res = await get(session.id);
  assert.equal(res.status, 200);
  const wire = await res.text();
  assert.equal(wire.includes(CANDIDATE_SAID), false, "not the candidate's words");
  assert.equal(wire.includes("Is the team hybrid?"), false, "not their forwarded question");
  assert.equal(wire.includes("how did I do"), false, "not the guardrail quote");
  const evidence = (JSON.parse(wire) as Body).evidence!;
  assert.ok(evidence.events.some((e) => e.kind === "guardrail" && e.guardrail === "score_request"), "the fact survives");
  assert.ok(evidence.events.some((e) => e.kind === "candidate_question"));
  assert.equal(evidence.agenda!.blocks.find((b) => b.id === "b1")!.covered, true);
});

test("an undirected session is observed:false with no agenda — not an empty set of zeroes", async () => {
  const { session } = directedCall({ agenda: null });
  const evidence = ((await (await get(session.id)).json()) as Body).evidence!;
  assert.equal(evidence.observed, false);
  assert.equal(evidence.agenda, null);
  assert.deepEqual(evidence.events, []);
  assert.deepEqual(evidence.recordings, []);
});

test("the recording ledger rides along as metadata, never as a file name", async () => {
  const { session } = directedCall();
  ensureDb()
    .prepare(`UPDATE interview_sessions SET recordings_json = ? WHERE id = ?`)
    .run(
      JSON.stringify([
        { attempt: 1, file: `${session.id}-a1.webm`, bytes: 1234, mime: "audio/webm", startedAt: new Date().toISOString(), endedAt: null, partial: true, deletedAt: null, deleteReason: null },
        { attempt: 2, file: `${session.id}-a2.webm`, bytes: 99, mime: "audio/webm", startedAt: new Date().toISOString(), endedAt: null, partial: false, deletedAt: new Date().toISOString(), deleteReason: "recruiter" },
      ]),
      session.id,
    );
  const evidence = ((await (await get(session.id)).json()) as Body).evidence!;
  assert.deepEqual(evidence.recordings.map((r) => r.state), ["available", "deleted"]);
  assert.equal(evidence.recordings[0].partial, true);
  assert.equal(evidence.recordings[1].deleteReason, "recruiter");
  assert.equal(JSON.stringify(evidence.recordings).includes(".webm"), false);
});
