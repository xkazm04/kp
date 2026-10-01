// The dial's geometry, the stage layout and the rack packing (pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { R, hitTest, pt, stageLayout } from "./wheelGeometry.ts";
import { CARD_GAP, cardMin, packRacks, rowColumns } from "./rackPack.ts";

test("pt: 0 degrees is 12 o'clock, 90 is 3 o'clock", () => {
  const [x0, y0] = pt(100, 0);
  assert.ok(Math.abs(x0) < 1e-9 && Math.abs(y0 + 100) < 1e-9);
  const [x1, y1] = pt(100, 90);
  assert.ok(Math.abs(x1 - 100) < 1e-9 && Math.abs(y1) < 1e-9);
});

test("stage: wide stages stack the plates without overlap and wire each to its sector", () => {
  const plates = [0, 1, 2, 3].map((i) => ({ key: `p${i}`, mid: 20 + i * 40, height: 70 }));
  const l = stageLayout({ width: 940, heightBudget: 700, plates, headHeight: 40 });
  assert.equal(l.wide, true);
  assert.equal(l.plates.length, 4);
  const ys = l.plates.map((p) => p.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 70, "no two plates overlap");
  for (const p of l.plates) assert.ok(p.x + l.plateW <= 940 + 1, "inside the stage");
  assert.ok(l.stageH >= l.svgH);
});

test("stage: a narrow stage leaves the plates to flow; no plates is not wide", () => {
  assert.equal(stageLayout({ width: 480, heightBudget: 700, plates: [{ key: "a", mid: 40, height: 60 }], headHeight: 30 }).wide, false);
  assert.equal(stageLayout({ width: 940, heightBudget: 700, plates: [], headHeight: 0 }).wide, false);
});

test("hitTest: a wide card is under the pointer; cards too close to aim at give the drawer", () => {
  const box = { left: 0, top: 0, width: 596, height: 864 }; // 1 unit = 1px, origin at (172, 432)
  const at = (deg: number, r: number) => { const [x, y] = pt(r, deg); return { x: x + 172, y: y + 432 }; };
  const drawers = [{ key: "d", a0: 5, a1: 175 }];
  const wide = hitTest(box, at(90, R.cardIn + 20), drawers, [{ id: "c1", drawerKey: "d", theta: 90, pitch: 6 }]);
  assert.deepEqual(wide, { drawerKey: "d", cardId: "c1" });
  const tight = hitTest(box, at(90, R.cardIn + 20), drawers, [{ id: "c1", drawerKey: "d", theta: 90, pitch: 0.5 }]);
  assert.deepEqual(tight, { drawerKey: "d", cardId: null });
  assert.equal(hitTest(box, at(90, 20), drawers, [{ id: "c1", drawerKey: "d", theta: 90, pitch: 6 }]), null, "the clock is not a drawer");
  assert.equal(hitTest(box, at(250, R.cardIn + 20), drawers, []), null);
});

test("racks: each asks for its cards' columns, a row takes the next rack while it fits, widths scale", () => {
  assert.equal(cardMin(900), 214);
  assert.equal(cardMin(3000), 262);
  const racks = [{ n: 0, span: 1 }, { n: 1, span: 1 }, { n: 5, span: 1 }, { n: 5, span: 1 }];
  const rows = packRacks(racks, 1100, 214);
  assert.equal(rows.flat().length, 4, "every rack is placed");
  for (const row of rows) {
    const cols = row.reduce((t, r) => t + r.span, 0);
    assert.ok(cols * 214 + (cols - row.length) * CARD_GAP <= 1100, "a row never exceeds the wall");
  }
  assert.match(rowColumns(rows[0], 214), /^minmax\(0, /);
  assert.equal(packRacks([], 900, 214).length, 0);
});
