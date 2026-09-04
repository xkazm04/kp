// The line between a DUPLICATE completion and a LOSER.
//
// /api/interview/complete answered both with `{ok:true, alreadyCompleted:true}`.
// Right for the duplicate (the End fetch racing its own unload beacon, a network
// retry, a replayed sessionStorage stash) — a green lie for the second tab, whose
// own conversation, own minutes and own turns are nowhere in the stored record
// while its candidate reads "saved".
//
// Runner: node:test with type stripping (npm run test:unit). Pure — no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { discardedTurnCount } from "./discarded-turns.ts";

const CALL = [
  { role: "interviewer", text: "Tell me about your last project." },
  { role: "candidate", text: "I built a test harness." },
  { role: "interviewer", text: "What was hard about it?" },
  { role: "candidate", text: "Flaky selectors." },
];

test("the same body posted twice loses nothing — the retrying client must settle green", () => {
  assert.equal(discardedTurnCount(CALL, CALL), 0);
});

test("an earlier snapshot of the SAME call loses nothing (the beacon fires a turn behind)", () => {
  assert.equal(discardedTurnCount(CALL, CALL.slice(0, 2)), 0);
  assert.equal(discardedTurnCount(CALL, CALL.slice(0, 3)), 0);
});

test("an empty body loses nothing — a call that never spoke has nothing to drop", () => {
  assert.equal(discardedTurnCount(CALL, []), 0);
  assert.equal(discardedTurnCount(null, []), 0);
});

test("a SECOND tab's conversation is reported in full, not as a diverging tail", () => {
  const other = [
    { role: "interviewer", text: "Tell me about your last project." },
    { role: "candidate", text: "I rewrote our billing importer." },
    { role: "interviewer", text: "Why did it need rewriting?" },
  ];
  // The opening line matches — the AI always opens the same way — and that shared
  // prefix is exactly why a naive equality check would have called this a
  // duplicate. The candidate is not told "we kept part of your interview": none
  // of this call is in the record that gets scored.
  assert.equal(discardedTurnCount(CALL, other), other.length);
});

test("a body that EXTENDS the stored transcript is a different call, not a longer duplicate", () => {
  const longer = [...CALL, { role: "candidate", text: "…and I fixed them with test ids." }];
  assert.equal(discardedTurnCount(CALL, longer), longer.length);
});

test("anything at all against an empty record is fully discarded", () => {
  assert.equal(discardedTurnCount(null, CALL), CALL.length);
  assert.equal(discardedTurnCount([], CALL), CALL.length);
});

test("the comparison reads role AND text — a re-attributed turn is a different call", () => {
  const reattributed = CALL.map((t, i) => (i === 1 ? { role: "interviewer", text: t.text } : t));
  assert.equal(discardedTurnCount(CALL, reattributed), reattributed.length);
});
