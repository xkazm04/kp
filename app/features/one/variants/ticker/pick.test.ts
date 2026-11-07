import { test } from "node:test";
import assert from "node:assert/strict";
import type { PanelInstance } from "../../types";
import { pick, stepsTo } from "./pick";

const p = (id: string, pinned = false): PanelInstance => ({ id, kind: "needs", params: {}, pinned });

test("the view in front is the table when it is not pinned", () => {
  const r = pick([p("p1"), p("p2"), p("p3")], "p1");
  assert.equal(r.main?.id, "p1");
  assert.deepEqual(r.sheets.map((x) => x.id), ["p1", "p2", "p3"]);
});

test("a pinned view in front leaves the table to the newest unpinned view", () => {
  const r = pick([p("p4"), p("p2", true), p("p3")], "p2");
  assert.equal(r.main?.id, "p4");
  assert.deepEqual(r.pins.map((x) => x.id), ["p2"]);
});

test("newest is by sequence, not by slot (a replacement keeps the old slot)", () => {
  assert.equal(pick([p("p12"), p("p9")], null).main?.id, "p12");
});

test("nothing unpinned on screen means no table", () => {
  const r = pick([p("p1", true), p("p2", true)], "p1");
  assert.equal(r.main, null);
  assert.equal(r.pins.length, 2);
});

test("stepsTo counts the walk from the cursor", () => {
  assert.equal(stepsTo(4, 1), -3);
  assert.equal(stepsTo(0, 2), 2);
});
