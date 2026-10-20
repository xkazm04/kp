// POST /api/interview/director — the live call's producer channel, driven through the
// REAL handler against an isolated DB. Pins: idempotent turn replay (ackSeq), the
// evidence-quote gate on mark_topic_covered, the guardrail record, endCall on
// end_interview, a directive that is persisted and not repeated, every refusal code,
// and that the response is a projection — no competency, no question, no brief.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { ensureDb } from "../../../_lib/db/core.ts";
import { appendInterviewEvents, listInterviewEvents } from "../../../_lib/db/interview-events.ts";
import { createInterviewSession, markInterviewStarted, revokeInterviewSession, completeInterviewSession } from "../../../_lib/db/interviews.ts";
import type { InterviewAgenda } from "../../../_lib/voice/director-types.ts";

after(() => cleanupUnitDb());

const PRIVATE_BRIEF = "You are an interviewer. Internal red flag — never say this aloud: claims 8 skills.";
const AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 30,
  hardCapMin: 36,
  closeReserveMin: 5,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: ["How are you?"] },
    { id: "b1", kind: "topic", title: "System design", budgetMin: 6, competency: "architecture-PRIVATE", scored: true, questions: ["PRIVATE-QUESTION-1"] },
    { id: "b2", kind: "topic", title: "Debugging", budgetMin: 6, competency: "debugging-PRIVATE", scored: true, questions: ["PRIVATE-QUESTION-2"] },
    { id: "b5", kind: "role_qa", title: "Your questions", budgetMin: 3, competency: null, scored: false, questions: [] },
    { id: "b6", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ],
};

/** A live, consented candidate call with the director's agenda on it. */
function liveSession(opts: { consent?: boolean; agenda?: InterviewAgenda | null } = {}) {
  const session = createInterviewSession({
    provider: "openai",
    mode: "candidate",
    candidateLabel: "Unit Candidate",
    jobTitle: "Backend Engineer",
    instructions: PRIVATE_BRIEF,
    durationMin: 30,
  });
  assert.ok(markInterviewStarted(session.id, opts.consent ?? true));
  const agenda = opts.agenda === undefined ? AGENDA : opts.agenda;
  if (agenda) ensureDb().prepare(`UPDATE interview_sessions SET agenda_json = ? WHERE id = ?`).run(JSON.stringify(agenda), session.id);
  return session;
}

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest("http://localhost/api/interview/director", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

function exchange(session: { id: string; token: string }, extra: Record<string, unknown> = {}) {
  return post({ token: session.token, sessionId: session.id, attempt: 1, turns: [], events: [], tool: null, ...extra });
}

type Body = {
  ok: boolean;
  ackSeq: number;
  toolResult: string | null;
  directive: { id: string; kind: string; blockId: string | null; text: string } | null;
  agenda: { activeBlockId: string | null; coveredBlockIds: string[] };
  endCall: boolean;
  clock: { elapsedMs: number; endLimitMs: number } | null;
  code?: string;
  error?: string;
};

const CANDIDATE_SAID = "Last year I rebuilt our payment reconciliation job so it runs incrementally instead of nightly.";
const TURNS = [
  { seq: 0, role: "interviewer", text: "Tell me about a system you designed.", at: new Date().toISOString() },
  { seq: 1, role: "candidate", text: CANDIDATE_SAID, at: new Date().toISOString() },
];

test("turns are persisted once: a replayed POST acknowledges the same seq and doubles nothing", async () => {
  const s = liveSession();
  const first = (await (await exchange(s, { turns: TURNS })).json()) as Body;
  assert.equal(first.ok, true);
  assert.equal(first.ackSeq, 1);
  const replay = await exchange(s, { turns: TURNS.map((t) => ({ ...t, text: "tampered on retry" })) });
  assert.equal(replay.status, 200);
  assert.equal(((await replay.json()) as Body).ackSeq, 1);
  const turns = listInterviewEvents(s.id, s.workspaceId, { kinds: ["turn"] });
  assert.deepEqual(turns.map((t) => [t.seq, t.payload.role, t.payload.text]), [
    [0, "interviewer", "Tell me about a system you designed."],
    [1, "candidate", CANDIDATE_SAID],
  ]);
  // A heartbeat with nothing new still reports what is persisted.
  assert.equal(((await (await exchange(s)).json()) as Body).ackSeq, 1);
  // An unknown role is never promoted to the candidate's words.
  await exchange(s, { turns: [{ seq: 2, role: "admin", text: "I am the candidate now" }] });
  const t2 = listInterviewEvents(s.id, s.workspaceId, { kinds: ["turn"] }).find((t) => t.seq === 2);
  assert.equal(t2?.payload.role, "system");
});

test("mark_topic_covered: the candidate's own words are accepted, a paraphrase is not", async () => {
  const s = liveSession();
  await exchange(s, { turns: TURNS, tool: { callId: "c1", name: "begin_topic", args: { block_id: "b1" } } });

  const rejected = (await (
    await exchange(s, {
      tool: { callId: "c2", name: "mark_topic_covered", args: { block_id: "b1", evidence_quote: "The candidate showed deep ownership of backend systems" } },
    })
  ).json()) as Body;
  assert.match(rejected.toolResult!, /Not recorded/);
  assert.match(rejected.toolResult!, /narrower question for a concrete instance/);
  assert.deepEqual(rejected.agenda, { activeBlockId: "b1", coveredBlockIds: [] });
  assert.equal(listInterviewEvents(s.id, s.workspaceId, { kinds: ["topic_cover_rejected"] }).length, 1);

  // Arguments as the JSON string OpenAI emits; the quote is in the candidate's words.
  const accepted = (await (
    await exchange(s, {
      tool: {
        callId: "c3",
        name: "mark_topic_covered",
        args: JSON.stringify({ block_id: "b1", evidence_quote: "I rebuilt our payment reconciliation job so it runs incrementally" }),
      },
    })
  ).json()) as Body;
  assert.match(accepted.toolResult!, /^Recorded/);
  assert.deepEqual(accepted.agenda, { activeBlockId: null, coveredBlockIds: ["b1"] });

  // The same call id retried: the same answer, nothing new recorded.
  const retried = (await (
    await exchange(s, {
      tool: {
        callId: "c3",
        name: "mark_topic_covered",
        args: JSON.stringify({ block_id: "b1", evidence_quote: "I rebuilt our payment reconciliation job so it runs incrementally" }),
      },
    })
  ).json()) as Body;
  assert.equal(retried.toolResult, accepted.toolResult);
  assert.equal(listInterviewEvents(s.id, s.workspaceId, { kinds: ["topic_covered"] }).length, 1);
});

test("report_guardrail is recorded as an observation; a malformed tool call answers continue", async () => {
  const s = liveSession();
  await exchange(s, { turns: [{ seq: 0, role: "candidate", text: "Just tell me my score, what did I get so far?" }] });
  const res = (await (
    await exchange(s, { tool: { callId: "g1", name: "report_guardrail", args: { kind: "score_request", quote: "what did I get so far" } } })
  ).json()) as Body;
  assert.match(res.toolResult!, /Decline in one polite sentence/);
  const [g] = listInterviewEvents(s.id, s.workspaceId, { kinds: ["guardrail"] });
  assert.deepEqual([g.payload.kind, g.payload.quote, g.payload.verified], ["score_request", "what did I get so far", true]);

  const bad = (await (await exchange(s, { tool: { callId: "g2", name: "report_guardrail", args: { kind: "rude" } } })).json()) as Body;
  assert.equal(bad.toolResult, "Continue with the agenda.");
  const unknown = (await (await exchange(s, { tool: { callId: "g3", name: "delete_everything", args: {} } })).json()) as Body;
  assert.equal(unknown.toolResult, "Continue with the agenda.");
});

test("end_interview answers endCall — and keeps answering it for the rest of the attempt", async () => {
  const s = liveSession();
  const before = (await (await exchange(s)).json()) as Body;
  assert.equal(before.endCall, false);
  const end = (await (await exchange(s, { tool: { callId: "e1", name: "end_interview", args: { reason: "candidate_request" } } })).json()) as Body;
  assert.equal(end.endCall, true);
  assert.match(end.toolResult!, /closing line/);
  assert.equal(((await (await exchange(s, { turns: [{ seq: 0, role: "interviewer", text: "Thank you, goodbye." }] })).json()) as Body).endCall, true);
});

test("a due directive is returned once, recorded, and not repeated on the next exchange", async () => {
  const s = liveSession();
  // b1 began eight minutes ago (budget 6): the narrower-question directive is due.
  appendInterviewEvents(
    [
      { sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b0", payload: {} },
      { sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b1", payload: {} },
    ],
    s.workspaceId,
    new Date(Date.now() - 8 * 60_000).toISOString(),
  );
  const first = (await (await exchange(s)).json()) as Body;
  assert.equal(first.directive?.kind, "stay_narrow");
  assert.equal(first.directive?.blockId, "b1");
  assert.ok(first.directive!.text.startsWith("[Director] "));
  assert.equal(listInterviewEvents(s.id, s.workspaceId, { kinds: ["directive"] }).length, 1, "the directive is part of the record");
  const second = (await (await exchange(s)).json()) as Body;
  assert.equal(second.directive, null, "one stay_narrow per block");
});

test("a session with no agenda is recorded but never directed", async () => {
  const s = liveSession({ agenda: null });
  appendInterviewEvents([{ sessionId: s.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "interviewer", text: "hi" } }], s.workspaceId, new Date(Date.now() - 90 * 60_000).toISOString());
  const res = (await (await exchange(s, { turns: [{ seq: 1, role: "candidate", text: "hello there" }] })).json()) as Body;
  assert.equal(res.directive, null);
  assert.equal(res.endCall, false, "no agenda, no clock");
  assert.equal(res.clock, null, "…and no end limit for the browser to re-arm to");
  assert.equal(res.ackSeq, 1);
});

test("the response is a projection: nothing private reaches the candidate's browser", async () => {
  const s = liveSession();
  appendInterviewEvents([{ sessionId: s.id, attempt: 1, kind: "topic_begun", blockId: "b1", payload: {} }], s.workspaceId, new Date(Date.now() - 7 * 60_000).toISOString());
  const res = await exchange(s, { turns: TURNS, tool: { callId: "p1", name: "forward_question", args: { question: "Is it remote?" } } });
  const raw = await res.text();
  const body = JSON.parse(raw) as Body;
  assert.deepEqual(Object.keys(body).sort(), ["ackSeq", "agenda", "clock", "directive", "endCall", "ok", "toolResult"]);
  assert.deepEqual(Object.keys(body.agenda).sort(), ["activeBlockId", "coveredBlockIds"]);
  // The clock is two numbers and nothing else — no agenda content rides it.
  assert.deepEqual(Object.keys(body.clock ?? {}).sort(), ["elapsedMs", "endLimitMs"]);
  assert.equal(body.clock?.endLimitMs, (36 + 2) * 60_000, "hardCap + 2 while nobody agreed to more");
  assert.ok(body.directive, "fixture: a directive rides this response");
  for (const marker of ["PRIVATE", "never say this aloud", "red flag", "competency", "architecture", "How are you?", s.workspaceId]) {
    assert.ok(!raw.includes(marker), `“${marker}” must never reach the candidate's browser`);
  }
});

test("every refusal carries a code", async () => {
  const s = liveSession();
  const cases: { name: string; res: Promise<Response>; status: number; code: string }[] = [
    { name: "no token", res: post({ sessionId: s.id, attempt: 1 }), status: 400, code: "INTERVIEW_LINK_NOT_FOUND" },
    { name: "unknown token", res: post({ token: "ivt-nope", sessionId: s.id, attempt: 1 }), status: 404, code: "INTERVIEW_LINK_NOT_FOUND" },
    { name: "sessionId of another call", res: post({ token: s.token, sessionId: "ivs-other", attempt: 1 }), status: 404, code: "INTERVIEW_LINK_NOT_FOUND" },
    { name: "sessionId missing", res: post({ token: s.token, attempt: 1 }), status: 404, code: "INTERVIEW_LINK_NOT_FOUND" },
    { name: "a stale attempt", res: exchange(s, { attempt: 2 }), status: 409, code: "INTERVIEW_NOT_LIVE" },
    { name: "no attempt", res: exchange(s, { attempt: undefined }), status: 409, code: "INTERVIEW_NOT_LIVE" },
    {
      name: "oversized body",
      res: post({ token: s.token, sessionId: s.id, attempt: 1, turns: [{ seq: 0, role: "candidate", text: "x".repeat(70 * 1024) }] }),
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    },
  ];
  const created = createInterviewSession({ provider: "openai", mode: "candidate", durationMin: 20 });
  cases.push({ name: "never connected", res: exchange(created), status: 409, code: "INTERVIEW_NOT_LIVE" });
  const revoked = liveSession();
  revokeInterviewSession(revoked.id);
  cases.push({ name: "revoked", res: exchange(revoked), status: 409, code: "INTERVIEW_LINK_INACTIVE" });
  const done = liveSession();
  completeInterviewSession(done.id, { transcript: [] });
  cases.push({ name: "completed", res: exchange(done), status: 409, code: "INTERVIEW_ALREADY_COMPLETED" });
  const noConsent = liveSession({ consent: false });
  cases.push({ name: "no consent on record", res: exchange(noConsent), status: 403, code: "INTERVIEW_CONSENT_REQUIRED" });

  for (const c of cases) {
    const res = await c.res;
    assert.equal(res.status, c.status, `${c.name}: status`);
    const body = (await res.json()) as Body;
    assert.equal(body.code, c.code, `${c.name}: code`);
    assert.equal(typeof body.error, "string", `${c.name}: the canonical sentence rides beside the code`);
  }
  assert.equal(listInterviewEvents(created.id, created.workspaceId).length, 0, "a refused exchange writes nothing");
});

test("end_interview(complete) before the topics are covered is refused and audited; the candidate's stop is not", async () => {
  const s = liveSession();
  const early = (await (await exchange(s, { tool: { callId: "x1", name: "end_interview", args: { reason: "complete" } } })).json()) as Body;
  assert.equal(early.toolResult, "Not yet — 2 topics remain. Continue with b1 · System design.");
  assert.equal(early.endCall, false, "the model cannot close an interview whose topics are open");
  assert.equal(((await (await exchange(s)).json()) as Body).endCall, false, "and the refusal does not end it later either");
  const [audit] = listInterviewEvents(s.id, s.workspaceId, { kinds: ["end_requested"] });
  assert.deepEqual([audit.payload.reason, audit.payload.refused], ["complete", true], "the attempt is on the record, marked refused");

  const stop = (await (await exchange(s, { tool: { callId: "x2", name: "end_interview", args: { reason: "candidate_request" } } })).json()) as Body;
  assert.equal(stop.endCall, true, "the candidate may stop whenever they want");
});

// ---- liveness ---------------------------------------------------------------------
// A directed call may run to the agenda's hard cap + 2 min — past the 30-minute live
// window measured from its connect. updated_at IS the connect (billing and the
// director's clock read it as the attempt's start), so each exchange stamps a separate
// last_activity_at, and the single-live / reissue guards read the later of the two.
test("an exchange keeps the call live without moving its connect time", async () => {
  const { getInterviewSessionById, isInterviewSessionLive } = await import("../../../_lib/db/interviews.ts");
  const session = liveSession();
  const longAgo = new Date(Date.now() - 40 * 60_000).toISOString();
  ensureDb().prepare(`UPDATE interview_sessions SET updated_at = ? WHERE id = ?`).run(longAgo, session.id);
  const stale = getInterviewSessionById(session.id)!;
  assert.equal(isInterviewSessionLive(stale), false, "40 minutes after connect, an undirected call is a zombie");

  const res = await exchange(session);
  assert.equal(res.status, 200);
  const after = getInterviewSessionById(session.id)!;
  assert.equal(after.updatedAt, longAgo, "the connect time is the attempt's start — never refreshed mid-call");
  assert.ok(after.lastActivityAt && Date.parse(after.lastActivityAt) > Date.parse(longAgo));
  assert.equal(isInterviewSessionLive(after), true, "a call still talking to the director is live");
});

test("liveness reads the later of connect and activity, and only for in_progress", async () => {
  const { isInterviewSessionLive } = await import("../../../_lib/db/interviews.ts");
  const now = Date.now();
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  const base = { status: "in_progress", createdAt: iso(60) };
  assert.equal(isInterviewSessionLive({ ...base, updatedAt: iso(5) }), true);
  assert.equal(isInterviewSessionLive({ ...base, updatedAt: iso(45) }), false);
  assert.equal(isInterviewSessionLive({ ...base, updatedAt: iso(45), lastActivityAt: iso(1) }), true);
  assert.equal(isInterviewSessionLive({ ...base, updatedAt: iso(45), lastActivityAt: iso(31) }), false);
  assert.equal(isInterviewSessionLive({ ...base, updatedAt: iso(45), lastActivityAt: "not a date" }), false);
  assert.equal(isInterviewSessionLive({ ...base, status: "failed", updatedAt: iso(1), lastActivityAt: iso(1) }), false);
});

// ---- a job kit's must-asks through the real exchange (spark interview-kit-template) ----

const KIT_AGENDA: InterviewAgenda = {
  ...AGENDA,
  blocks: AGENDA.blocks.map((b) => (b.id === "b2" ? { ...b, mustAsks: [{ id: "q-must", text: "PRIVATE-MUSTASK" }] } : b)),
};

function backdate(s: { id: string; workspaceId: string }, minutesAgo: number, kind: "topic_begun" | "directive" | "overrun_answered", payload: Record<string, unknown> = {}) {
  appendInterviewEvents(
    [{ sessionId: s.id, attempt: 1, kind, blockId: "b2", payload }],
    s.workspaceId,
    new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  );
}

test("kit must-asks: the overrun is asked at the reserve, reported by tool, and only agreement outlasts the hard stop", async () => {
  // At the close reserve (31 of 30 booked / 36 cap / 5 reserve) with the required question owed.
  const atReserve = liveSession({ agenda: KIT_AGENDA });
  backdate(atReserve, 31.5, "topic_begun");
  const asked = (await (await exchange(atReserve)).json()) as Body;
  assert.equal(asked.directive?.kind, "ask_overrun");
  assert.match(asked.directive!.text, /1 required question/);
  assert.doesNotMatch(JSON.stringify(asked), /PRIVATE-MUSTASK/, "the question text never reaches the browser");

  // The interviewer reports the answer through the tool; the record keeps it.
  const reported = (await (
    await exchange(atReserve, { tool: { callId: "x1", name: "report_extra_time", args: { answer: "agreed" } } })
  ).json()) as Body;
  assert.match(reported.toolResult!, /Ask the required questions that remain/);
  assert.equal(listInterviewEvents(atReserve.id, atReserve.workspaceId, { kinds: ["overrun_answered"] })[0]?.payload.answer, "agreed");

  // 40 minutes in — past hardCap + 2 = 38 — the ordinary stop holds a call nobody agreed to extend…
  const silent = liveSession({ agenda: KIT_AGENDA });
  backdate(silent, 40, "topic_begun");
  backdate(silent, 9, "directive", { kind: "ask_overrun" });
  const stopped = (await (await exchange(silent)).json()) as Body;
  assert.equal(stopped.endCall, true);
  assert.equal(stopped.clock?.endLimitMs, 38 * 60_000, "no agreement: the limit the browser was armed at stands");

  // …but not one the candidate agreed to: it runs on toward 2 × 30 = 60.
  const agreed = liveSession({ agenda: KIT_AGENDA });
  backdate(agreed, 40, "topic_begun");
  backdate(agreed, 9, "directive", { kind: "ask_overrun" });
  backdate(agreed, 8.5, "overrun_answered", { answer: "agreed" });
  const running = (await (await exchange(agreed)).json()) as Body;
  assert.equal(running.endCall, false);
  assert.notEqual(running.directive?.kind, "end_now");
  assert.equal(running.clock?.endLimitMs, 60 * 60_000, "the browser learns the moved limit and re-arms its fallback stop");
  assert.ok((running.clock?.elapsedMs ?? 0) >= 40 * 60_000 - 5_000);

  // Past the absolute ceiling nothing holds it.
  const over = liveSession({ agenda: KIT_AGENDA });
  backdate(over, 61, "topic_begun");
  backdate(over, 30, "directive", { kind: "ask_overrun" });
  backdate(over, 29.5, "overrun_answered", { answer: "agreed" });
  assert.equal(((await (await exchange(over)).json()) as Body).endCall, true);

  // Ending records which required question went unasked.
  await exchange(silent, { tool: { callId: "x2", name: "end_interview", args: { reason: "time" } } });
  const unasked = listInterviewEvents(silent.id, silent.workspaceId, { kinds: ["must_ask_unasked"] });
  assert.deepEqual(unasked.map((e) => [e.blockId, e.payload.questionId, e.payload.question]), [["b2", "q-must", "PRIVATE-MUSTASK"]]);
});

// LAST in the file: it drops the table out from under the store.
test("a store failure answers a coded 500 and never the raw error", async () => {
  const s = liveSession();
  ensureDb().exec(`DROP TABLE interview_events`);
  const originalError = console.error;
  console.error = () => {}; // safeJsonError logs the raw error server-side; keep the test output clean
  try {
    const res = await exchange(s, { turns: TURNS });
    assert.equal(res.status, 500);
    const raw = await res.text();
    const body = JSON.parse(raw) as Body;
    assert.equal(body.code, "INTERVIEW_DIRECTOR_FAILED");
    assert.doesNotMatch(raw, /no such table|interview_events|sqlite/i);
  } finally {
    console.error = originalError;
  }
});
