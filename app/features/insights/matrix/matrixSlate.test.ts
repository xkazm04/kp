// Challenge 2026-09-22 matrix-grid/B: the grid proposes a one-role-per-candidate slate
// over the VISIBLE rectangle. These cases pin the allocator's honesty rules: no blocked,
// in-flight or sub-floor pick; no comparative claim over one assessed candidate; a
// contested role names the stronger candidate who went elsewhere; the proposal loads
// into a NEW selection and never mutates the old one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { applySlateToSelection, proposeSlate } from "./matrixSlate.ts";
import { matrixCellKey, visibleMatrixCellKeys } from "./matrixSelection.ts";
import { FIT_PROMISING_FLOOR } from "../../../_lib/fit-thresholds.ts";
import type { Cell } from "./matrixCellClass.ts";

type C = { id: string; label: string };
type P = { id: string; title: string };
const sc = (score: number, extra: Partial<Cell> = {}): Cell => ({ score, blocked: false, ...extra });
const ko: Cell = { score: null, blocked: true, koKeys: ["language"] };

function grid(cands: C[], poss: P[], cells: Cell[][], placements: Record<string, { stage: string; status: string }> = {}) {
  return {
    rows: cands.map((cand, ri) => ({ cand, ri })),
    cols: poss.map((p, i) => ({ p, i })),
    cells,
    placements,
    locale: "en",
  };
}
const line = (s: ReturnType<typeof proposeSlate>, posId: string) => s.lines.find((l) => l.posId === posId)!;

const A = { id: "a", label: "Alice" };
const B = { id: "b", label: "Bob" };
const Cc = { id: "c", label: "Cyril" };
const R1 = { id: "r1", title: "Role one" };
const R2 = { id: "r2", title: "Role two" };

test("one role per candidate: the stronger candidate takes R1, R2 is contested and names her", () => {
  const s = proposeSlate(grid([A, B], [R1, R2], [[sc(90), sc(88)], [ko, sc(80)]]));
  assert.equal(line(s, "r1").pick?.candId, "a");
  assert.equal(line(s, "r2").pick?.candId, "b");
  const r2 = line(s, "r2");
  assert.equal(r2.state, "contested");
  assert.equal(r2.rival?.candId, "a");
  assert.equal(r2.rival?.score, 88);
  assert.equal(r2.rival?.placedOn, "Role one");
  assert.equal(s.filled, 2);
  assert.equal(s.total, 2);
});

test("never a blocked cell or an in-flight pair; a rejected/declined pair IS eligible", () => {
  const cells = [[ko, sc(92)], [sc(85), sc(60)], [sc(75), sc(70)]];
  const s = proposeSlate(
    grid([A, B, Cc], [R1, R2], cells, {
      "b|r1": { stage: "Screened", status: "active" },
      "a|r2": { stage: "Screened", status: "declined" },
      "c|r1": { stage: "Screened", status: "rejected" },
    }),
  );
  assert.equal(line(s, "r2").pick?.candId, "a", "a declined pair is eligible again");
  assert.equal(line(s, "r1").pick?.candId, "c", "b is in flight on r1 and a is blocked there");
  for (const l of s.lines) {
    if (!l.pick) continue;
    const ri = [A, B, Cc].findIndex((c) => c.id === l.pick!.candId);
    const ci = [R1, R2].findIndex((p) => p.id === l.posId);
    assert.equal(cells[ri][ci].blocked, false);
  }
  // A pair the recruiter just added in this session is in flight too.
  const s2 = proposeSlate({ ...grid([A], [R1], [[sc(90), sc(0)]]), added: new Set([matrixCellKey("a", "r1")]) });
  assert.equal(line(s2, "r1").pick, null);
});

test("a role whose best eligible score is under the promising floor is uncovered, never a sub-floor pick", () => {
  const s = proposeSlate(grid([A, B], [R1], [[sc(FIT_PROMISING_FLOOR - 1)], [sc(30)]]));
  assert.equal(line(s, "r1").pick, null);
  assert.equal(line(s, "r1").state, "uncovered");
  assert.equal(s.filled, 0);
  const atFloor = proposeSlate(grid([A, B], [R1], [[sc(FIT_PROMISING_FLOOR)], [sc(30)]]));
  assert.equal(line(atFloor, "r1").pick?.candId, "a");
});

test("one assessed candidate yields a thin pick, never clear", () => {
  const s = proposeSlate(grid([A, B], [R1], [[sc(91)], [ko]]));
  assert.equal(line(s, "r1").pick?.candId, "a");
  assert.equal(line(s, "r1").state, "thin");
  const two = proposeSlate(grid([A, B], [R1], [[sc(91)], [sc(40)]]));
  assert.equal(line(two, "r1").state, "clear");
});

test("only the visible rectangle participates", () => {
  // The caller passes the visible rows/cols: B is floored out, R2 filtered away.
  const all = grid([A, B, Cc], [R1, R2], [[sc(80), sc(99)], [sc(95), sc(95)], [sc(70), sc(60)]]);
  const rows = all.rows.filter((r) => r.cand.id !== "b");
  const cols = all.cols.filter((c) => c.p.id !== "r2");
  const s = proposeSlate({ ...all, rows, cols });
  const visible = visibleMatrixCellKeys(rows, cols);
  assert.deepEqual(s.lines.map((l) => l.posId), ["r1"]);
  for (const k of applySlateToSelection(new Set(), s)) assert.ok(visible.has(k), k);
  assert.equal(line(s, "r1").pick?.candId, "a");
});

test("deterministic: equal scores break by locale-collated label, then id", () => {
  const z = { id: "z", label: "Čeněk" };
  const d = { id: "d", label: "Dana" };
  const cells = [[sc(80)], [sc(80)]];
  const cs = proposeSlate({ ...grid([d, z], [R1], cells), locale: "cs" });
  assert.equal(line(cs, "r1").pick?.candId, "z", "cs sorts Č before D");
  const again = proposeSlate({ ...grid([d, z], [R1], cells), locale: "cs" });
  assert.deepEqual(again, cs);
  const twins = proposeSlate(grid([{ id: "y", label: "Sam" }, { id: "x", label: "Sam" }], [R1], cells));
  assert.equal(line(twins, "r1").pick?.candId, "x");
});

test("applySlateToSelection returns a new Set of exactly the picks and leaves the old one alone", () => {
  const s = proposeSlate(grid([A, B], [R1, R2], [[sc(90), sc(88)], [ko, sc(80)]]));
  const prev = new Set(["q|r9"]);
  const next = applySlateToSelection(prev, s);
  assert.notEqual(next, prev);
  assert.deepEqual([...prev], ["q|r9"]);
  assert.deepEqual([...next].sort(), [matrixCellKey("a", "r1"), matrixCellKey("b", "r2")]);
  const dropped = applySlateToSelection(prev, { ...s, lines: s.lines.filter((l) => l.posId !== "r2") });
  assert.deepEqual([...dropped], [matrixCellKey("a", "r1")]);
});

test("the confidence band says whether the pick's lead is outside its own margin", () => {
  const band = (low: number, high: number) => ({ confidence: { low, high, level: "medium" } });
  const wide = proposeSlate(grid([A, B], [R1], [[sc(80, band(72, 88))], [sc(75)]]));
  assert.equal(line(wide, "r1").separated, false);
  const tight = proposeSlate(grid([A, B], [R1], [[sc(80, band(78, 82))], [sc(75)]]));
  assert.equal(line(tight, "r1").separated, true);
  const none = proposeSlate(grid([A, B], [R1], [[sc(80)], [sc(75)]]));
  assert.equal(line(none, "r1").separated, null);
});
