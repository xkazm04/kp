// The status line is the deck's one greppable sentence per scene — the thing a
// sceptical reader is meant to be able to take away and search for. Six scenes
// build theirs through `statusPicker`, and until this file nothing checked that
// the beat table a scene author writes is the beat sequence a reader sees.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { statusPicker } from "./status.ts";

test("a beat holds until the next declared one", () => {
  // The reason scenes declare status sparsely: the table reads as prose, and
  // re-timing a scene does not mean re-stating every intermediate beat.
  const at = statusPicker({ 0: "outline", 3: "scoring", 9: "verdict" });

  assert.equal(at(0), "outline");
  assert.equal(at(1), "outline");
  assert.equal(at(2), "outline");
  assert.equal(at(3), "scoring");
  assert.equal(at(8), "scoring");
  assert.equal(at(9), "verdict");
  assert.equal(at(40), "verdict", "the last beat holds for the rest of the loop");
});

test("an empty beat BLANKS the line instead of re-printing the last one", () => {
  // The intentional-silence edge, and the one this originally got wrong: `if
  // (hit)` walks straight past "" and prints the previous sentence again. A
  // scene writes an empty beat for the pause before a verdict, and a stale
  // sentence there is worse than silence — the line's whole contract is that it
  // says what the machine is doing RIGHT NOW.
  const at = statusPicker({ 0: "reading", 4: "", 6: "decided" });

  assert.equal(at(3), "reading");
  assert.equal(at(4), "", "beat 4 declares silence — that is a value, not a miss");
  assert.equal(at(5), "", "and silence holds like any other beat");
  assert.equal(at(6), "decided");
});

test("a beat before the first declared one falls back rather than crashing", () => {
  // Real path, not defensive: the clock rewinds to 0 on every re-entry, and a
  // scene may open on a beat its table does not name.
  assert.equal(statusPicker({ 2: "late" })(0), "", "no beat 0 declared — the line is empty, not `undefined`");
  assert.equal(statusPicker({ 2: "late" })(1), "");
  assert.equal(statusPicker({ 2: "late" })(2), "late");
  assert.equal(statusPicker({})(0), "", "an empty table is a scene with no status line");
});

test("a fractional phase reads as the beat it is inside", () => {
  // `phase` is an integer everywhere in the deck, but the picker is a public
  // pure function and a non-integer must not walk the loop forever or index a
  // hole. It floors — you are in beat 3 until beat 4 starts.
  const at = statusPicker({ 0: "a", 3: "b" });
  assert.equal(at(2.9), "a");
  assert.equal(at(3.4), "b");
});
