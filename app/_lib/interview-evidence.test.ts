// The recruiter evidence PROJECTION (WP4), pinned as a pure table.
//
// What these cases hold, in one line each: the projection carries only the fields a
// surface needs, private brief material and tool bookkeeping never cross, "not
// measured" survives as null instead of collapsing to 0, coverage is the director's own
// derivation rather than a second opinion, the bound is honest, the consent redaction
// keeps the structure and drops the words, and a recording's state is what the playback
// door will actually do.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildInterviewEvidence,
  EVIDENCE_EVENT_LIMIT,
  projectEvidenceEvent,
  redactEvidenceEvent,
  type EvidenceSourceEvent,
} from "./interview-evidence.ts";
import type { InterviewAgenda, RecordingMeta } from "./voice/director-types.ts";

const T0 = Date.parse("2026-09-01T10:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const AGENDA: InterviewAgenda = {
  version: 1,
  durationMin: 30,
  hardCapMin: 36,
  closeReserveMin: 5,
  blocks: [
    { id: "b0", kind: "warmup", title: "Warm-up", budgetMin: 2, competency: null, scored: false, questions: ["How are you?"] },
    { id: "b1", kind: "topic", title: "System design", budgetMin: 6, competency: "architecture-PRIVATE", scored: true, questions: ["PRIVATE-Q1"] },
    { id: "b2", kind: "topic", title: "Debugging", budgetMin: 6, competency: "debugging-PRIVATE", scored: true, questions: ["PRIVATE-Q2"] },
    { id: "b3", kind: "role_qa", title: "Your questions", budgetMin: 3, competency: null, scored: false, questions: [] },
    { id: "b4", kind: "close", title: "Wrap-up", budgetMin: 2, competency: null, scored: false, questions: [] },
  ],
};

function ev(partial: Partial<EvidenceSourceEvent> & Pick<EvidenceSourceEvent, "kind">, atMs: number): EvidenceSourceEvent {
  return {
    attempt: 1,
    seq: null,
    blockId: null,
    payload: {},
    at: iso(atMs),
    createdAt: iso(atMs),
    ...partial,
  };
}

const SESSION = {
  id: "iv-1",
  provider: "openai",
  status: "completed",
  attempts: 1,
  agenda: AGENDA,
  startedAt: iso(0),
  endedAt: iso(20 * 60_000),
  recordings: [] as RecordingMeta[],
};

function build(events: EvidenceSourceEvent[], over: Partial<Parameters<typeof buildInterviewEvidence>[0]> = {}) {
  return buildInterviewEvidence({ session: SESSION, events, retentionDue: false, withholdVerbatim: false, ...over });
}

test("a turn projects role, text, block and an offset on the SERVER clock", () => {
  const p = projectEvidenceEvent(
    ev({ kind: "turn", seq: 3, blockId: "b1", payload: { role: "candidate", text: "I rebuilt the reconciliation job." } }, 90_000),
    T0,
  );
  assert.deepEqual(p, {
    kind: "turn",
    attempt: 1,
    seq: 3,
    blockId: "b1",
    at: iso(90_000),
    offsetMs: 90_000,
    role: "candidate",
    text: "I rebuilt the reconciliation job.",
  });
});

test("tool bookkeeping and the directive's injected text never reach the projection", () => {
  const covered = projectEvidenceEvent(
    ev({ kind: "topic_covered", blockId: "b1", payload: { quote: "we ran it incrementally", callId: "call_abc", toolResult: "Recorded." } }, 1),
    T0,
  );
  assert.equal(covered.quote, "we ran it incrementally");
  assert.equal("callId" in covered, false);
  assert.equal("toolResult" in covered, false);

  const directive = projectEvidenceEvent(
    ev({ kind: "directive", blockId: "b1", payload: { kind: "stay_narrow", directiveId: "dir-1", text: "[Director] Ask one narrower question." } }, 2),
    T0,
  );
  assert.equal(directive.directive, "stay_narrow");
  assert.equal("text" in directive, false, "a stage direction is an instruction to the model, not evidence about the candidate");
});

test("answer timing keeps its nulls: a provider that cannot measure says so, never 0", () => {
  const unmeasurable = projectEvidenceEvent(ev({ kind: "answer_timing", payload: { turnSeq: 4, preSilenceMs: null, durationMs: null } }, 5), T0);
  assert.equal(unmeasurable.preSilenceMs, null);
  assert.equal(unmeasurable.durationMs, null);
  assert.notEqual(unmeasurable.preSilenceMs, 0);

  const measured = projectEvidenceEvent(ev({ kind: "answer_timing", payload: { turnSeq: 5, preSilenceMs: 1200, durationMs: 31_000 } }, 6), T0);
  assert.equal(measured.preSilenceMs, 1200);
  assert.equal(measured.durationMs, 31_000);
});

test("a guardrail carries its kind, the quoted words and whether they were verified", () => {
  const p = projectEvidenceEvent(
    ev({ kind: "guardrail", blockId: "b2", payload: { kind: "score_request", quote: "what score did I get", verified: true, callId: "c1" } }, 7),
    T0,
  );
  assert.equal(p.guardrail, "score_request");
  assert.equal(p.quote, "what score did I get");
  assert.equal(p.verified, true);
  assert.equal("callId" in p, false);
});

test("the agenda projection carries no competency and no planned questions", () => {
  const out = build([ev({ kind: "topic_begun", blockId: "b1" }, 60_000)]);
  assert.ok(out.agenda);
  const block = out.agenda.blocks.find((b) => b.id === "b1")!;
  assert.deepEqual(Object.keys(block).sort(), ["begun", "budgetMin", "covered", "id", "kind", "scored", "spentMs", "title"]);
  const wire = JSON.stringify(out);
  assert.equal(wire.includes("PRIVATE"), false, "no competency and no planned question crosses the boundary");
});

test("coverage is the DIRECTOR's derivation — begun, covered and the block's own clock", () => {
  const out = build([
    ev({ kind: "topic_begun", blockId: "b0" }, 0),
    ev({ kind: "topic_covered", blockId: "b0", payload: { quote: "good morning" } }, 60_000),
    ev({ kind: "topic_begun", blockId: "b1" }, 60_000),
    ev({ kind: "topic_covered", blockId: "b1", payload: { quote: "we ran it incrementally" } }, 6 * 60_000),
  ]);
  const byId = Object.fromEntries(out.agenda!.blocks.map((b) => [b.id, b]));
  assert.equal(byId.b0.covered, true);
  assert.equal(byId.b1.covered, true);
  assert.equal(byId.b2.covered, false);
  assert.equal(byId.b2.begun, false);
  assert.equal(byId.b1.spentMs, 5 * 60_000);
  // The scored flags survive: warm-up, role questions and closing are "not assessed".
  assert.deepEqual(
    out.agenda!.blocks.filter((b) => !b.scored).map((b) => b.id),
    ["b0", "b3", "b4"],
  );
});

test("elapsed is measured to the call's END, not to the reader's wall clock", () => {
  const out = build([ev({ kind: "turn", seq: 0, payload: { role: "interviewer", text: "Hello." } }, 0)]);
  // The session ended 20 minutes in; reading it days later must still say 20 minutes.
  assert.equal(out.elapsedMs, 20 * 60_000);
});

test("the bound is stated and honest", () => {
  const many = Array.from({ length: EVIDENCE_EVENT_LIMIT + 10 }, (_, i) =>
    ev({ kind: "turn", seq: i, payload: { role: "candidate", text: `turn ${i}` } }, i * 10),
  );
  const out = build(many, { limit: 50 });
  assert.equal(out.limit, 50);
  assert.equal(out.truncated, true);
  assert.equal(out.events.length, 50);
  assert.equal(out.events[0].text, `turn ${many.length - 50}`, "the MOST RECENT rows are the ones kept");
  // Truncation must not slide the clock: the origin is taken over every row.
  assert.equal(out.startedAt, iso(0));

  const small = build(many.slice(0, 3));
  assert.equal(small.truncated, false);
  assert.equal(small.limit, EVIDENCE_EVENT_LIMIT);
});

test("withheld consent keeps the structure and drops every verbatim word", () => {
  const events = [
    ev({ kind: "turn", seq: 0, blockId: "b1", payload: { role: "candidate", text: "SECRET WORDS" } }, 0),
    ev({ kind: "guardrail", blockId: "b1", payload: { kind: "off_topic", quote: "SECRET WORDS", verified: true } }, 10),
    ev({ kind: "candidate_question", blockId: "b3", payload: { question: "SECRET WORDS" } }, 20),
  ];
  const out = build(events, { withholdVerbatim: true });
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
  assert.equal(out.events.length, 3);
  assert.equal(out.events[1].guardrail, "off_topic");
  assert.equal(out.events[1].blockId, "b1");
  assert.equal(out.events[1].verified, true, "that the record was checkable is structure, not words");

  // The redactor itself, on one event.
  const bare = redactEvidenceEvent({ kind: "turn", attempt: 1, seq: 0, blockId: null, at: iso(0), offsetMs: 0, role: "candidate", text: "x" });
  assert.equal("text" in bare, false);
  assert.equal(bare.role, "candidate");
});

test("an unasked kit must-ask reaches the recruiter — in its own field, kept even when consent is withheld", () => {
  const unasked = ev(
    {
      kind: "must_ask_unasked",
      blockId: "b2",
      payload: { questionId: "q-must", question: "How do you decide what to automate first?", endReason: "time", callId: "c9", toolResult: "Recorded." },
    },
    19 * 60_000,
  );
  const p = projectEvidenceEvent(unasked, T0);
  assert.equal(p.unaskedQuestion, "How do you decide what to automate first?");
  assert.equal(p.unaskedQuestionId, "q-must");
  assert.equal(p.endReason, "time");
  assert.equal(p.blockId, "b2");
  assert.equal(p.question, undefined, "never the field that carries the CANDIDATE's forwarded words");
  assert.equal(JSON.stringify(p).includes("toolResult"), false, "tool bookkeeping stays server-side");

  // The consent gate strips the candidate's words, not the interviewer's own question.
  const out = build(
    [ev({ kind: "turn", seq: 0, blockId: "b1", payload: { role: "candidate", text: "SECRET WORDS" } }, 0), unasked],
    { withholdVerbatim: true },
  );
  assert.equal(JSON.stringify(out).includes("SECRET"), false);
  assert.equal(out.events[1].unaskedQuestion, "How do you decide what to automate first?");

  // The candidate's answer to the overrun request stays a bare kind: not a fact about them.
  const answered = projectEvidenceEvent(ev({ kind: "overrun_answered", blockId: "b2", payload: { answer: "declined", remaining: 1 } }, 18 * 60_000), T0);
  assert.equal(JSON.stringify(answered).includes("declined"), false);
});

test("a recording's state is what the playback door will do — and never its file name", () => {
  const recordings: RecordingMeta[] = [
    { attempt: 1, file: "iv-1-a1.webm", bytes: 900, mime: "audio/webm", startedAt: iso(0), endedAt: iso(100), partial: true, deletedAt: null, deleteReason: null },
    { attempt: 2, file: "iv-1-a2.webm", bytes: 10, mime: "audio/webm", startedAt: iso(0), endedAt: null, partial: false, deletedAt: iso(500), deleteReason: "candidate_request" },
  ];
  const live = build([], { session: { ...SESSION, recordings } });
  assert.deepEqual(live.recordings.map((r) => r.state), ["available", "deleted"]);
  assert.equal(live.recordings[0].partial, true);
  assert.equal(JSON.stringify(live.recordings).includes(".webm"), false, "a path is not a fact a browser needs");

  const expired = build([], { session: { ...SESSION, recordings }, retentionDue: true });
  assert.deepEqual(expired.recordings.map((r) => r.state), ["expired", "deleted"]);
});

test("an undirected call is `observed: false` — nothing to report, and it does not read as zero", () => {
  const out = build([], { session: { ...SESSION, agenda: null } });
  assert.equal(out.observed, false);
  assert.equal(out.agenda, null);
  assert.equal(out.events.length, 0);
});

test("the timing source names HOW the provider measured, and the two are not one number", () => {
  assert.equal(build([]).timingSource, "speech_boundaries");
  assert.equal(build([], { session: { ...SESSION, provider: "elevenlabs" } }).timingSource, "vad_windows");
  assert.equal(build([], { session: { ...SESSION, provider: "somebody-else" } }).timingSource, null);
});
