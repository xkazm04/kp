import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countByLayer, fieldColumns, fieldHeight, foldOrder, groupByLayer, itemsPerDot, placeDots, pourDuration, pourPlan, fallEase, popScale,
  type SieveItem,
} from "./sieveLayout.ts";
import { cssSafeId, dotBody, dotClass, fieldMarkup } from "./sieveDots.ts";
import { claimPlay, hasPlayed, resetPlayed } from "./playOnce.ts";
import { furthestReached, laneEnds, stepFigure, stepFill } from "./railModel.ts";
import { barBox, brushBox, growDelay, inBrush, nextFocus, nullRun, rankAt, skyGeometry, SKY } from "./skylineGeometry.ts";
import { shapeClass } from "./shapeModel.ts";

const item = (id: string, layer: string, shape: SieveItem["shape"] = "solid", extra: Partial<SieveItem> = {}): SieveItem => ({ id, layer, shape, ...extra });

test("sieve: one dot per item up to the budget, then ceil(n / budget) per dot", () => {
  assert.equal(itemsPerDot(128), 1);
  assert.equal(itemsPerDot(400), 1);
  assert.equal(itemsPerDot(401), 2);
  assert.equal(itemsPerDot(1200, 400), 3);
});

test("sieve: field columns are whole pitches of the field, never fewer than four", () => {
  assert.equal(fieldColumns(604), 40);
  assert.equal(fieldColumns(20), 4);
  assert.equal(fieldHeight(0, 40), 24, "an empty layer keeps the row floor");
  assert.equal(fieldHeight(41, 40), 2 * 15 + 6);
});

test("sieve: items group by layer; over budget a group is binned and the bin keeps its size", () => {
  const items = [item("a", "S"), item("b", "S"), item("c", "S"), item("d", "O")];
  const g1 = groupByLayer(["S", "O", "H"], items, 1);
  assert.deepEqual(Object.keys(g1), ["S", "O", "H"]);
  assert.deepEqual(g1.H, [], "a layer nobody stands in is still a group");
  const g2 = groupByLayer(["S", "O"], items, 2);
  assert.deepEqual(g2.S.map((b) => [b.id, b.n]), [["a", 2], ["c", 1]]);
  assert.deepEqual(countByLayer(["S", "O", "H"], items), { S: 3, O: 1, H: 0 }, "the count is items, never bins");
});

test("sieve: dots fill each field row-major, the block centred in its field", () => {
  const groups = groupByLayer(["S"], [item("a", "S"), item("b", "S"), item("c", "S"), item("d", "S"), item("e", "S")], 1);
  const dots = placeDots(groups, { S: { left: 100, top: 50, height: 36 } }, 4, 15);
  assert.equal(dots.length, 5);
  // two lines (30px) centred in 36px -> y0 = 53; first centre = 53 + 7.5
  assert.deepEqual([dots[0].x, dots[0].y], [107.5, 60.5]);
  assert.deepEqual([dots[4].x, dots[4].y], [107.5, 75.5], "the fifth dot wraps to the second line");
});

test("sieve: fold order puts walked first, then name-only, exits, placed, nothing on record; rank breaks ties", () => {
  const rank: Record<string, number> = { a: 3, b: 1, c: 2, d: 0, e: 4 };
  const sorted = foldOrder(
    [{ id: "a", shape: "ring" as const }, { id: "b", shape: "solid" as const }, { id: "c", shape: "dashed" as const }, { id: "d", shape: "exit" as const }, { id: "e", shape: "solid" as const }],
    (x) => rank[x.id]
  );
  assert.deepEqual(sorted.map((x) => x.id), ["b", "e", "d", "a", "c"]);
});

test("sieve: the pour drops walked dots first and pops placed ones after, inside ~900ms", () => {
  const dots = ["solid", "ring", "solid", "dashed", "exit"].map((shape, i) => ({ item: { shape: shape as SieveItem["shape"] }, i }));
  const plan = pourPlan(dots);
  const byIndex = Object.fromEntries(plan.map((p) => [p.index, p]));
  assert.equal(byIndex[0].kind, "fall");
  assert.equal(byIndex[4].kind, "fall", "an exit fell out through the layers");
  assert.equal(byIndex[1].kind, "pop");
  assert.equal(byIndex[3].kind, "fade", "nothing on record fades in, it never moves");
  assert.ok(plan.filter((p) => p.kind !== "fall").every((p) => p.delay >= 320), "placed dots appear after the fall began landing");
  assert.ok(pourDuration(plan) <= 900, `the pour stays inside the 600-900ms sequence (${pourDuration(plan)}ms)`);
  assert.equal(fallEase(0), 0);
  assert.equal(fallEase(1), 1);
  assert.ok(Math.abs(popScale(0.7) - 1.18) < 1e-9 && Math.abs(popScale(1) - 1) < 1e-9);
});

test("sieve dots: shape geometry, the waiting halo, bin counts and safe ids", () => {
  const solid = { item: { ...item("a", "S"), n: 1 }, x: 0, y: 0 };
  assert.match(dotBody(solid), /^<circle class="k-dot__fill" r="5\.1"\/>$/);
  const needs = { item: { ...item("b", "S", "ring", { needs: true }), n: 3 }, x: 0, y: 0 };
  assert.match(dotBody(needs), /k-dot__halo[\s\S]*k-dot__line[\s\S]*<text class="k-dot__n" y="3.5">3<\/text>/);
  assert.match(dotBody({ item: { ...item("c", "S", "exit"), n: 1 }, x: 0, y: 0 }), /k-dot__x/);
  assert.match(dotBody({ item: { ...item("d", "S", "dashed"), n: 1 }, x: 0, y: 0 }), /k-dot__line is-dashed/);
  assert.equal(dotClass(needs, true, false), "k-dot k-dot--ring k-tone--default is-needs is-dim");
  assert.equal(cssSafeId('x"><script>'), "x___script_");
  assert.match(fieldMarkup([solid], new Set(["a"]), "a"), /class="k-dot k-dot--solid k-tone--default is-dim is-picked" data-id="a" transform="translate\(0\.0 0\.0\)"/);
});

test("motion plays once per (part, replayKey), never under reduced motion, and the key is still spent", () => {
  resetPlayed();
  assert.equal(claimPlay("p", "k1", false), true);
  assert.equal(claimPlay("p", "k1", false), false, "an equal key does not replay");
  assert.equal(claimPlay("q", "k1", false), true, "another part plays its own");
  assert.equal(claimPlay("p", "k2", false), true, "a data change replays");
  assert.equal(claimPlay("r", "k1", true), false, "reduced motion resolves to the final frame");
  assert.equal(hasPlayed("r", "k1"), true);
  assert.equal(claimPlay("r", "k1", false), false, "turning reduced motion off later does not replay stale data");
});

test("stage rail: fill is reached/of clamped; a null is unknown, an absent step reads none", () => {
  assert.equal(stepFill({ reached: 12, of: 45 }), 12 / 45);
  assert.equal(stepFill({ reached: 60, of: 45 }), 1);
  assert.equal(stepFill({ reached: null, of: 45 }), 0);
  assert.equal(stepFill({ reached: 3, of: 0 }), 0);
  assert.deepEqual(stepFigure({ id: "a", label: "A", reached: null, of: 4 }), { kind: "unknown" });
  assert.deepEqual(stepFigure({ id: "a", label: "A", reached: 0, of: 4, absent: "not in this plan" }), { kind: "none" });
  assert.deepEqual(stepFigure({ id: "a", label: "A", reached: 3, of: 4 }), { kind: "fraction", reached: 3, of: 4 });
});

test("lane: the path runs first reached -> last reached; dashed and none never count", () => {
  assert.deepEqual(laneEnds([{ shape: "none" }, { shape: "solid" }, { shape: "dashed" }, { shape: "ring" }, { shape: "none" }]), { first: 1, last: 3 });
  assert.equal(laneEnds([{ shape: "none" }, { shape: "dashed" }]), null);
  assert.equal(furthestReached([{ shape: "half" }, { shape: "none" }]), 0);
});

test("skyline: one bar per item while bars stay >= 3px, binned beyond; nulls are stubs, not zero", () => {
  const g = skyGeometry(128, 1000, 168);
  assert.equal(g.per, 1);
  assert.equal(g.columns, 128);
  assert.ok(g.barWidth >= 2 && g.barWidth <= SKY.maxBar);
  const tight = skyGeometry(500, 400, 168);
  assert.equal(tight.per, Math.ceil(500 / Math.floor((400 - SKY.left - SKY.right) / 3)));
  const stub = barBox(g, 5, null);
  const zero = barBox(g, 5, 0);
  assert.ok(stub.h > zero.h, "a never-scored stub is visibly taller than a zero bar");
  assert.equal(zero.h, 2, "a zero keeps a 2px sliver, it never disappears");
});

test("skyline: brush, hit-testing, the null run and the keyboard stay on item ranks", () => {
  const g = skyGeometry(100, 1044, 168); // plot 1000px -> 10px per column
  assert.equal(g.step, 10);
  assert.deepEqual(brushBox(g, [2, 4]), { x: SKY.left + 20, w: 30 });
  assert.equal(inBrush(g, 3, [2, 4]), true);
  assert.equal(inBrush(g, 5, [2, 4]), false);
  assert.equal(inBrush(g, 5, null), true);
  assert.equal(rankAt(g, SKY.left + 25, 100), 2);
  assert.equal(rankAt(g, -50, 100), 0);
  assert.equal(rankAt(g, 5000, 100), 99);
  const items = Array.from({ length: 100 }, (_, i) => ({ id: String(i), label: String(i), value: i < 65 ? 90 - i : null }));
  assert.deepEqual(nullRun(items, g), { count: 35, x: SKY.left + 650 });
  assert.equal(nextFocus(5, "ArrowRight", false, 100), 6);
  assert.equal(nextFocus(5, "ArrowLeft", true, 100), 0);
  assert.equal(nextFocus(95, "ArrowRight", true, 100), 99);
  assert.equal(nextFocus(5, "End", false, 100), 99);
  assert.equal(nextFocus(5, "a", false, 100), null);
  assert.ok(growDelay(127, 128) <= 520);
});

test("shape mark: kind first, then the stage tone", () => {
  assert.equal(shapeClass("ring", "offer"), "k-shp k-shp--ring k-tone--offer");
  assert.equal(shapeClass("dashed"), "k-shp k-shp--dashed");
});
