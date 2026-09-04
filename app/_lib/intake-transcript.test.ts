// The stored intake transcript is BOUNDED, and says so.
//
// Pre-fix every turn was appended forever: the row, the JSON written into the
// spawn workdir twice per exchange, and the session read all grew without limit
// — for turns pipeline/jobfit/intake.py stopped rendering into any prompt after
// the newest 48. These pin the cap AND the disclosure, because a transcript that
// silently starts mid-sentence is indistinguishable from data loss.
//
// Runner: npm run test:unit (node:test + type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VoiceTurn } from "./voice/types.ts";
import { COMPACTED_TURN_PREFIX, MAX_STORED_TURNS, capTranscript, compactedTurnCount } from "./intake-transcript.ts";

const turns = (n: number, from = 0): VoiceTurn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("candidate" as const) : ("interviewer" as const),
    text: `turn ${from + i}`,
    at: `2026-01-01T00:00:0${(from + i) % 10}Z`,
  }));

test("the cap is the engine's own prompt window", () => {
  assert.equal(MAX_STORED_TURNS, 48);
});

test("a transcript under the cap is returned untouched", () => {
  const t = turns(MAX_STORED_TURNS);
  assert.equal(capTranscript(t), t);
});

test("over the cap: the newest N are kept and the loss is disclosed", () => {
  const capped = capTranscript(turns(60));
  // 48 kept + one marker turn.
  assert.equal(capped.length, MAX_STORED_TURNS + 1);
  assert.equal(compactedTurnCount(capped[0]), 12);
  assert.equal(capped[1]?.text, "turn 12");
  assert.equal(capped.at(-1)?.text, "turn 59");
});

test("compaction is idempotent — the marker accumulates instead of stacking", () => {
  const once = capTranscript(turns(60));
  const twice = capTranscript([...once, ...turns(10, 60)]);
  assert.equal(twice.length, MAX_STORED_TURNS + 1);
  // 12 already gone + the 10 the second pass pushed off the front.
  assert.equal(compactedTurnCount(twice[0]), 22);
  assert.equal(compactedTurnCount(twice[1]), 0, "only ONE marker turn, ever");
  assert.equal(twice.at(-1)?.text, "turn 69");
});

test("the marker is a machine token, never a stored English sentence", () => {
  const marker = capTranscript(turns(60))[0]!;
  assert.equal(marker.role, "system");
  assert.equal(marker.text, `${COMPACTED_TURN_PREFIX}12`);
  assert.match(marker.text, /^kp:/, "a wire token the panel localizes, not copy");
});

test("compactedTurnCount refuses to read a token it does not recognise", () => {
  assert.equal(compactedTurnCount(undefined), 0);
  assert.equal(compactedTurnCount({ role: "system", text: "Re-opened by the operator." }), 0);
  assert.equal(compactedTurnCount({ role: "candidate", text: `${COMPACTED_TURN_PREFIX}9` }), 0);
  assert.equal(compactedTurnCount({ role: "system", text: `${COMPACTED_TURN_PREFIX}nope` }), 0);
  assert.equal(compactedTurnCount({ role: "system", text: `${COMPACTED_TURN_PREFIX}0` }), 0);
});
