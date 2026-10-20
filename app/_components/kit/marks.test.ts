// Marks carry meaning by SHAPE (kit.js MK): every MarkKind has geometry, the two kinds that
// borrow another's colour say so in their class, and only the actor kinds have a hollow
// (generated) form. Also pins the DataTable's track mapping (meta+N) that places cells.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { MARK_SHAPES, markClass, markShapes } from "./marks.ts";
import { columnTrack, isMetaTrack } from "./tracks.ts";

const KINDS = ["ok", "wait", "needs", "fail", "bounce", "recovered", "unknown", "caution", "human", "machine", "nobody"] as const;

test("every mark kind has geometry", () => {
  for (const k of KINDS) assert.ok(MARK_SHAPES[k].length > 0, k);
});

test("status is told apart by shape, not colour alone", () => {
  const sig = (k: (typeof KINDS)[number]) => JSON.stringify(MARK_SHAPES[k]);
  assert.notEqual(sig("ok"), sig("wait"), "a filled dot and a ring");
  assert.notEqual(sig("fail"), sig("bounce"));
  assert.notEqual(sig("needs"), sig("caution"));
});

test("bounce wears the failure colour and nobody the unknown colour", () => {
  assert.equal(markClass("bounce"), "k-mark k-mark--fail");
  assert.equal(markClass("nobody"), "k-mark k-mark--unknown");
  assert.equal(markClass("ok"), "k-mark k-mark--ok");
});

test("hollow is the generated form of an actor; other kinds ignore it", () => {
  assert.equal(markShapes("human", true)[0].fill, undefined);
  assert.equal(markShapes("human")[0].fill, true);
  assert.deepEqual(markShapes("ok", true), MARK_SHAPES.ok);
});

test("a column names a track: meta+N lands on the N-th sub-track after the meta line", () => {
  assert.equal(columnTrack("name"), "name");
  assert.equal(columnTrack("meta"), "meta");
  assert.equal(columnTrack("meta+1"), "4");
  assert.equal(columnTrack("meta+2"), "5");
  assert.ok(isMetaTrack("meta+1") && isMetaTrack("meta") && !isMetaTrack("fig"));
});
