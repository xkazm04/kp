// Pins the transcript-of-record merge (challenge-r07 voice-interview-api/A): the
// director's ledger is what a directed interview SAID; the hang-up POST only adds
// what the ledger had not yet received. Pure — no DB, no request.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ledgerTurnsFromEvents,
  transcriptOfRecord,
  type LedgerTurn,
  type SubmittedTurn,
} from "./transcript-of-record.ts";
import { MAX_TURN_TEXT_CHARS } from "../interview-transcript.ts";

function roleAt(i: number): "interviewer" | "candidate" {
  return i % 2 === 0 ? "interviewer" : "candidate";
}

/** `n` ledger turns for one attempt, text `a<attempt>-<seq>`. */
function ledgerAttempt(attempt: number, n: number): LedgerTurn[] {
  return Array.from({ length: n }, (_, seq) => ({ attempt, seq, role: roleAt(seq), text: `a${attempt}-${seq}` }));
}

function asBody(turns: readonly LedgerTurn[]): SubmittedTurn[] {
  return turns.map((t) => ({ role: t.role, text: t.text }));
}

function texts(turns: readonly SubmittedTurn[]): string[] {
  return turns.map((t) => t.text);
}

test("undirected passthrough: no ledger turns -> the body byte for byte, nothing unanchored", () => {
  const S: SubmittedTurn[] = [
    { role: "interviewer", text: "Hello", at: "2026-09-23T10:00:00.000Z" },
    { role: "candidate", text: "Hi there" },
    { role: "weird", text: "kept as sent", at: 42 },
  ];
  const r = transcriptOfRecord({ ledgerTurns: [], submitted: S });
  assert.deepEqual(r.turns, S);
  assert.equal(r.unanchored, 0);
  assert.equal(r.mode, "passthrough");
});

test("resumed call keeps its opening: 55 + 10 ledger turns, a 52-turn body -> 67 turns from attempt 1 seq 0", () => {
  const a1 = ledgerAttempt(1, 55);
  const a2 = ledgerAttempt(2, 10);
  const unacked: SubmittedTurn[] = [
    { role: "candidate", text: "and one more thing" },
    { role: "interviewer", text: "Thank you, that is all." },
  ];
  // resume.ts seeds the LAST 40 earlier-attempt turns: attempt-1 seq 15..54.
  const body = [...asBody(a1.slice(15)), ...asBody(a2), ...unacked];
  assert.equal(body.length, 52);
  const r = transcriptOfRecord({ ledgerTurns: [...a2, ...a1], submitted: body });
  assert.equal(r.turns.length, 67);
  assert.equal(r.turns[0].text, "a1-0", "the opening of the interview is the first stored turn");
  assert.deepEqual(texts(r.turns.slice(-2)), texts(unacked));
  assert.equal(r.unanchored, 0);
  assert.equal(r.mode, "anchored");
});

test("a hang-up POST cannot rewrite a received turn: the ledger's text stands", () => {
  const ledger = ledgerAttempt(1, 6);
  const body = asBody(ledger);
  body[3] = { role: "candidate", text: "I single-handedly led the migration of 40 services" };
  const r = transcriptOfRecord({ ledgerTurns: ledger, submitted: body });
  assert.deepEqual(texts(r.turns), texts(ledger));
  assert.ok(!r.turns.some((t) => t.text.includes("single-handedly")), "the edited text is not persisted");
});

test("a fabricated mid-call turn is not stored and is counted", () => {
  const ledger = ledgerAttempt(1, 6);
  const body = asBody(ledger);
  body.splice(3, 0, { role: "candidate", text: "I also hold a PhD in distributed systems" });
  const r = transcriptOfRecord({ ledgerTurns: ledger, submitted: body });
  assert.deepEqual(texts(r.turns), texts(ledger));
  assert.equal(r.unanchored, 1);
});

test("the unacknowledged tail survives, in body order, after the ledger turns", () => {
  const ledger = ledgerAttempt(1, 4);
  const tail: SubmittedTurn[] = [
    { role: "candidate", text: "and that was the rollout" },
    { role: "system", text: "[the connection dropped before the answer was heard]" },
  ];
  const r = transcriptOfRecord({ ledgerTurns: ledger, submitted: [...asBody(ledger), ...tail] });
  assert.deepEqual(texts(r.turns), [...texts(ledger), ...texts(tail)]);
  assert.equal(r.turns.at(-1)?.role, "system");
});

test("a ledger the director stopped appending to still anchors on its last stored turn", () => {
  const all = ledgerAttempt(1, 12);
  const stored = all.slice(0, 7); // MAX_INTERVIEW_EVENTS_PER_SESSION reached after seq 6
  const r = transcriptOfRecord({ ledgerTurns: stored, submitted: asBody(all) });
  assert.deepEqual(texts(r.turns), texts(all));
  assert.equal(r.unanchored, 0);
});

test("anchor miss degrades: every ledger turn + the body's system turns, never an empty record", () => {
  const ledger = ledgerAttempt(1, 6);
  const body: SubmittedTurn[] = [
    ...asBody(ledger.slice(0, 3)),
    { role: "system", text: "[interviewer audio unavailable]" },
    { role: "candidate", text: "something the ledger never heard" },
  ];
  const r = transcriptOfRecord({ ledgerTurns: ledger, submitted: body });
  assert.equal(r.mode, "anchor_miss");
  assert.deepEqual(texts(r.turns), [...texts(ledger), "[interviewer audio unavailable]"]);
});

test("the anchor compares CLAMPED text: an over-long final turn still anchors", () => {
  const long = "x".repeat(MAX_TURN_TEXT_CHARS + 50);
  const ledger: LedgerTurn[] = [
    { attempt: 1, seq: 0, role: "interviewer", text: "Hi" },
    { attempt: 1, seq: 1, role: "candidate", text: long.slice(0, MAX_TURN_TEXT_CHARS) },
  ];
  const body: SubmittedTurn[] = [
    { role: "interviewer", text: "Hi" },
    { role: "candidate", text: long },
    { role: "interviewer", text: "Thanks" },
  ];
  const r = transcriptOfRecord({ ledgerTurns: ledger, submitted: body });
  assert.equal(r.mode, "anchored");
  assert.deepEqual(texts(r.turns).at(-1), "Thanks");
  assert.equal(r.turns.length, 3);
});

test("ledgerTurnsFromEvents keeps turn rows only, normalizes the role, orders by (attempt, seq)", () => {
  const ev = (attempt: number, seq: number | null, kind: string, payload: Record<string, unknown>) => ({
    kind,
    attempt,
    seq,
    payload,
    at: "2026-09-23T10:00:00.000Z",
  });
  const turns = ledgerTurnsFromEvents([
    ev(2, 0, "turn", { role: "candidate", text: "late" }),
    ev(1, 1, "turn", { role: "bogus", text: "marker" }),
    ev(1, null, "topic_begun", { blockId: "b1" }),
    ev(1, 0, "turn", { role: "interviewer", text: "first" }),
  ]);
  assert.deepEqual(
    turns.map((t) => [t.attempt, t.seq, t.role, t.text]),
    [
      [1, 0, "interviewer", "first"],
      [1, 1, "system", "marker"],
      [2, 0, "candidate", "late"],
    ]
  );
});
