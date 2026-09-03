// Pins the rediscovery feed's dismiss rollback (lot JW, wave 22).
//
// The feed's add flow keeps the row for a beat so the green "Added ✓" badge can
// render, then dismisses it. When that deferred DELETE (a PATCH) fails, the row
// is restored — and the restored row was rendered with BOTH marks at once: the
// green "Added" badge from the successful pipeline add AND the red "Couldn't
// dismiss that match" note. Two contradictory claims about one row, and the
// recruiter cannot tell which one to act on.
//
// The rule pinned here: a rollback restores the ROW, and drops the added mark
// with it, so the feed reads one truth — the candidate is back in the list and
// the panel says why.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRow, restoreRow, dropAddedMark } from "./jobsRediscoveryDismiss.ts";

type Row = { id: string; candidateId: string };
const rows = (): Row[] => [
  { id: "a1", candidateId: "c1" },
  { id: "a2", candidateId: "c2" },
  { id: "a3", candidateId: "c3" },
];

test("extract remembers the row AND the position it was dropped from", () => {
  const { next, removed } = extractRow(rows(), "a2");
  assert.deepEqual(next?.map((r) => r.id), ["a1", "a3"]);
  assert.equal(removed?.index, 1);
  assert.equal(removed?.row.id, "a2");
});

test("extracting an id that is not in the list changes nothing", () => {
  const before = rows();
  const { next, removed } = extractRow(before, "nope");
  assert.equal(next, before); // same reference — no needless re-render
  assert.equal(removed, null);
});

test("a failed dismiss puts the row back where it was", () => {
  const { next, removed } = extractRow(rows(), "a2");
  const restored = restoreRow(next, removed);
  assert.deepEqual(restored?.map((r) => r.id), ["a1", "a2", "a3"]);
});

test("a rollback never duplicates a row the list already regained", () => {
  const { removed } = extractRow(rows(), "a2");
  const restored = restoreRow(rows(), removed); // a sweep already brought a2 back
  assert.deepEqual(restored?.map((r) => r.id), ["a1", "a2", "a3"]);
});

test("a row dropped from the end restores at the end of a shorter list", () => {
  const { removed } = extractRow(rows(), "a3");
  const restored = restoreRow([{ id: "a1", candidateId: "c1" }], removed);
  assert.deepEqual(restored?.map((r) => r.id), ["a1", "a3"]);
});

test("the restored row is NOT still marked added — one truth per row", () => {
  const added = new Set(["c1", "c2"]);
  const next = dropAddedMark(added, "c2"); // c2's deferred dismiss failed
  assert.equal(next.has("c2"), false); // no green "Added ✓" over a red rollback
  assert.equal(next.has("c1"), true); // another candidate's badge is untouched
  assert.equal(added.has("c2"), true); // pure: the input set is not mutated
});

test("a manual dismiss (no candidate) leaves every added mark alone", () => {
  const added = new Set(["c1"]);
  assert.deepEqual([...dropAddedMark(added, undefined)], ["c1"]);
});
