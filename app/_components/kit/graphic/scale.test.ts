// The graphic layer at scale: the Sieve's bar threshold and the StageCells bead cap (scaleModel.ts),
// plus the wiring that makes the threshold additive (unset = the dots, at every size).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capBeads, drawsBars, sieveBars, SIEVE_BARS_ABOVE } from "./scaleModel.ts";
import type { SieveItem } from "./sieveLayout.ts";

const item = (id: string, layer: string, shape: SieveItem["shape"] = "solid", extra: Partial<SieveItem> = {}): SieveItem => ({ id, layer, shape, ...extra });

test("the bar threshold is opt-in and strict: unset never draws bars, N items at a threshold of N still draw dots", () => {
  assert.equal(drawsBars(5000, undefined), false, "a Sieve that never asked keeps its dots at any size");
  assert.equal(drawsBars(SIEVE_BARS_ABOVE, SIEVE_BARS_ABOVE), false);
  assert.equal(drawsBars(SIEVE_BARS_ABOVE + 1, SIEVE_BARS_ABOVE), true);
  assert.equal(drawsBars(0, 0), false, "nothing to draw is never a bar");
  assert.ok(SIEVE_BARS_ABOVE <= 300, "the pipeline threshold stays at about 300 dots");
});

test("bars: every item counted once, lengths relative to the fullest layer, the dimmed kept apart", () => {
  const items = [
    item("a", "S", "solid", { tone: "screened", needs: true }), item("b", "S", "ring", { tone: "screened" }), item("c", "S", "solid", { tone: "screened" }),
    item("d", "S", "dashed", { tone: "screened" }), item("e", "I", "solid", { tone: "interview" }), item("x", "OUT", "exit", { tone: "out" }),
  ];
  const bars = sieveBars(["S", "I", "O", "OUT"], items, new Set(["b", "c"]));
  assert.deepEqual([bars.S.count, bars.S.kept, bars.S.needs, bars.S.share], [4, 2, 1, 1]);
  assert.equal(bars.I.share, 0.25);
  assert.deepEqual(bars.O, { count: 0, kept: 0, share: 0, needs: 0, sample: [] }, "an empty layer is a zero, not missing");
  assert.deepEqual(bars.S.sample.map((s) => [s.shape, s.n]), [["solid", 2], ["ring", 1], ["dashed", 1]], "observed first, then placed, then nothing on record");
  assert.equal(bars.S.sample[0].tone, "screened");
  assert.deepEqual(bars.OUT.sample.map((s) => s.shape), ["exit"]);
});

test("bars stay cheap at scale: 3000 items become one record per layer", () => {
  const many = Array.from({ length: 3000 }, (_, i) => item(`i${i}`, ["A", "B", "C"][i % 3], i % 2 ? "solid" : "ring"));
  const bars = sieveBars(["A", "B", "C"], many);
  assert.equal(Object.keys(bars).length, 3);
  assert.equal(bars.A.count + bars.B.count + bars.C.count, 3000);
  assert.equal(bars.A.kept, bars.A.count, "no dim set keeps everyone");
});

test("beads: capped, the waiting ones first, and +N counts exactly what the cap left out", () => {
  const cell = ["p", "q", "r", "s", "t", "u", "v"].map((id) => ({ id, shape: "solid" as const, needs: id === "u" || id === "v" }));
  const { beads, more } = capBeads(cell, 5);
  assert.deepEqual(beads.map((b) => b.id), ["u", "v", "p", "q", "r"]);
  assert.equal(more, 2);
  assert.deepEqual(capBeads(cell.slice(0, 3), 5), { beads: cell.slice(0, 3), more: 0 }, "under the cap: all of them, in order");
  assert.equal(capBeads(cell, 0).more, 7);
});

test("the Sieve takes the threshold as an additive prop and draws no dots in bar mode", () => {
  const src = readFileSync(new URL("./Sieve.tsx", import.meta.url), "utf8");
  assert.match(src, /barsAbove\?: number;/);
  assert.match(src, /drawsBars\(items\.length, barsAbove\) \? sieveBars\(ids, items, dim\) : null/);
  assert.match(src, /enabled: ready && !bars/, "the dot field is never measured or poured in bar mode");
  assert.match(src, /ready && !bars \? <svg/);
  assert.match(src, /budget = 400/, "the dot budget keeps its default");
});
