// The street's roving keyboard map, the level grammar and the corridor geometry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SIGN_ROW, cellKey, clampCell, moveCell, parseCellKey } from "./lineupGrid.ts";
import { LINEUP_ROOT, depthOf, floorOf, layerKey, lineupReduce, sameEntry, stairDirection, topOf, type LineupEntry } from "./lineupNav.ts";
import { CORRIDOR_TURN, FULL_INSET, bandInset, corridorFrames, stairFrames } from "./corridor.ts";

test("arrows walk a floor and climb a building; edges hold (and still own the key)", () => {
  assert.equal(SIGN_ROW, 7);
  assert.deepEqual(moveCell({ row: 2, col: 3 }, "ArrowRight", 20), { row: 2, col: 4 });
  assert.deepEqual(moveCell({ row: 2, col: 20 }, "ArrowRight", 20), { row: 2, col: 20 });
  assert.deepEqual(moveCell({ row: 2, col: 1 }, "ArrowLeft", 20), { row: 2, col: 0 }, "into the floor directory");
  assert.deepEqual(moveCell({ row: 0, col: 5 }, "ArrowUp", 20), { row: 0, col: 5 });
  assert.deepEqual(moveCell({ row: 6, col: 5 }, "ArrowDown", 20), { row: SIGN_ROW, col: 5 });
  assert.equal(moveCell({ row: 1, col: 1 }, "g", 20), null, "letters are not the street's");
  assert.equal(moveCell({ row: 1, col: 1 }, "Enter", 20), null);
});

test("the directory has no sign row; the sign row never steps into the directory", () => {
  assert.deepEqual(moveCell({ row: 6, col: 0 }, "ArrowDown", 20), { row: 6, col: 0 });
  assert.deepEqual(moveCell({ row: SIGN_ROW, col: 1 }, "ArrowLeft", 20), { row: SIGN_ROW, col: 1 });
  assert.deepEqual(moveCell({ row: 3, col: 0 }, "PageDown", 20), { row: 6, col: 0 });
  assert.deepEqual(moveCell({ row: 3, col: 9 }, "PageDown", 20), { row: SIGN_ROW, col: 9 });
  assert.deepEqual(moveCell({ row: 3, col: 9 }, "PageUp", 20), { row: 0, col: 9 });
  assert.deepEqual(moveCell({ row: 3, col: 9 }, "Home", 20), { row: 3, col: 1 });
  assert.deepEqual(moveCell({ row: 3, col: 9 }, "End", 20), { row: 3, col: 20 });
});

test("a cell outside a smaller street is clamped; keys round-trip", () => {
  assert.deepEqual(clampCell({ row: 9, col: 30 }, 5), { row: SIGN_ROW, col: 5 });
  assert.deepEqual(clampCell({ row: SIGN_ROW, col: 0 }, 5), { row: 6, col: 0 });
  assert.deepEqual(parseCellKey(cellKey({ row: 4, col: 12 })), { row: 4, col: 12 });
  assert.equal(parseCellKey("x"), null);
  assert.equal(parseCellKey(undefined), null);
});

test("levels: walk into a floor, take the stairs, come back out; a floor already open is returned to", () => {
  const skills: LineupEntry = { level: 1, dimension: "skills", focus: null };
  const trust: LineupEntry = { level: 1, dimension: "trust", focus: "m1" };
  const s1 = lineupReduce(LINEUP_ROOT, { type: "push", entry: skills });
  assert.equal(depthOf(s1), 1);
  assert.equal(floorOf(s1), "skills");
  const s2 = lineupReduce(s1, { type: "replaceTop", entry: trust });
  assert.deepEqual(topOf(s2), trust);
  assert.equal(depthOf(lineupReduce(s2, { type: "push", entry: { level: 1, dimension: "trust", focus: null } })), 1);
  assert.deepEqual(lineupReduce(s2, { type: "pop" }), LINEUP_ROOT);
  assert.equal(floorOf(LINEUP_ROOT), null);
  assert.ok(sameEntry(trust, { level: 1, dimension: "trust", focus: null }), "focus is not a place");
  assert.ok(!sameEntry(trust, skills));
  assert.equal(layerKey({ level: 0 }, 0), "street");
  assert.equal(layerKey(skills, 1), "floor-1-skills");
});

test("the stairs go down towards the street and up towards the roof", () => {
  assert.equal(stairDirection("fit", "skills"), 1);
  assert.equal(stairDirection("publicWork", "trust"), -1);
});

test("the corridor opens from the pressed floor's band, runs it across the level, then opens; a close plays it back", () => {
  const layer = { left: 100, top: 50, width: 1000, height: 800 };
  const band = { left: 240, top: 300, width: 840, height: 28 };
  assert.equal(bandInset(layer, band), "inset(250px 20px 522px 140px round 6px)");
  const strip = "inset(250px 0px 522px 0px round 0px)";
  const open = corridorFrames(layer, band, "open");
  assert.deepEqual(open.map((f) => f.clipPath), [bandInset(layer, band), strip, FULL_INSET]);
  assert.deepEqual(open.map((f) => f.offset), [0, CORRIDOR_TURN, 1]);
  const close = corridorFrames(layer, band, "close");
  assert.deepEqual(close.map((f) => f.clipPath), [FULL_INSET, strip, bandInset(layer, band)], "a close plays the corridor back");
  assert.deepEqual(close.map((f) => f.offset), [0, 1 - CORRIDOR_TURN, 1]);
  assert.equal(bandInset(layer, null), "inset(0px 0px 768px 0px round 6px)", "no band: a strip across the top");
  assert.equal(stairFrames(1)[0].transform, "translateY(28px)");
  assert.equal(stairFrames(-1)[0].transform, "translateY(-28px)");
});
