// The live transcript yanked a reader who had scrolled up back to the bottom on
// every append, keyed turns by their index in the RENDERED list, and grew without
// bound. Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import {
  FOLLOW_SLACK_PX,
  MAX_VISIBLE_TURNS,
  foldTranscript,
  shouldFollow,
  turnKey,
} from "./transcript-follow.ts";

const turns = (n: number): VoiceTurn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "candidate" : "interviewer",
    text: `turn ${i}`,
    at: `2026-09-03T10:00:${String(i % 60).padStart(2, "0")}.000Z`,
  }));

test("a reader parked at the bottom keeps following the newest turn", () => {
  assert.equal(shouldFollow(1000, 1520, 520), true, "exactly at the bottom");
  assert.equal(shouldFollow(1000 - FOLLOW_SLACK_PX, 1520, 520), true, "within the sub-pixel slack");
});

test("a reader who scrolled up is NOT yanked back — the bug this exists for", () => {
  assert.equal(shouldFollow(0, 4000, 520), false, "scrolled to the very top");
  assert.equal(shouldFollow(3000, 4000, 520), false, "reading a few exchanges back");
});

test("a log shorter than its box always follows", () => {
  assert.equal(shouldFollow(0, 200, 520), true);
});

test("a short transcript renders whole, with nothing folded", () => {
  const t = turns(5);
  const { visible, folded } = foldTranscript(t);
  assert.equal(folded, 0);
  assert.equal(visible.length, 5);
  assert.deepEqual(
    visible.map((p) => p.index),
    [0, 1, 2, 3, 4]
  );
});

test("a long transcript keeps the newest window and counts what it folded", () => {
  const t = turns(MAX_VISIBLE_TURNS + 25);
  const { visible, folded } = foldTranscript(t);
  assert.equal(visible.length, MAX_VISIBLE_TURNS, "the log stops growing");
  assert.equal(folded, 25, "the candidate is TOLD how many are above, not quietly trimmed");
  assert.equal(visible[visible.length - 1].turn.text, `turn ${MAX_VISIBLE_TURNS + 24}`, "newest turn last");
  assert.equal(visible[0].index, 25, "indices stay full-transcript positions");
});

test("keys are stable across the append that starts folding", () => {
  const before = foldTranscript(turns(MAX_VISIBLE_TURNS), MAX_VISIBLE_TURNS);
  const after = foldTranscript(turns(MAX_VISIBLE_TURNS + 1), MAX_VISIBLE_TURNS);
  const lastBefore = before.visible[before.visible.length - 1];
  const sameTurnAfter = after.visible.find((p) => p.turn.text === lastBefore.turn.text);
  assert.ok(sameTurnAfter);
  assert.equal(
    turnKey(sameTurnAfter),
    turnKey(lastBefore),
    "the same turn must keep its key when an older one folds away — an index into the " +
      "rendered slice would have re-numbered every visible turn"
  );
  // And two different turns never collide.
  assert.notEqual(turnKey(after.visible[0]), turnKey(after.visible[1]));
});
