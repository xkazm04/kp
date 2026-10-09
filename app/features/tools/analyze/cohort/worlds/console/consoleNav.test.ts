import { test } from "node:test";
import assert from "node:assert/strict";
import { BUS_ORDER } from "./consoleModel.ts";
import {
  CONSOLE_ROOT, DESK_ROWS, busAtRow, busBand, consoleReduce, layerKey, moveDesk, rowOfBus, soloFrames, stepBus, topOf,
  type ConsoleStack,
} from "./consoleNav.ts";

test("a solo pushes one level; soloing the same bus again returns to it, a pop goes home", () => {
  const one = consoleReduce(CONSOLE_ROOT, { type: "push", entry: { level: 1, dimension: "skills", focus: "a" } });
  assert.equal(one.length, 2);
  const again = consoleReduce(one, { type: "push", entry: { level: 1, dimension: "skills", focus: "b" } });
  assert.equal(again.length, 2);
  assert.deepEqual(topOf(again), { level: 1, dimension: "skills", focus: "b" });
  assert.deepEqual(consoleReduce(one, { type: "pop" }), CONSOLE_ROOT);
  assert.deepEqual(consoleReduce(CONSOLE_ROOT, { type: "pop" }), CONSOLE_ROOT);
});

test("a sideways step keeps the level and swaps the bus", () => {
  const one: ConsoleStack = [{ level: 0 }, { level: 1, dimension: "fit", focus: null }];
  const next = consoleReduce(one, { type: "replaceTop", entry: { level: 1, dimension: stepBus("fit", 1), focus: null } });
  assert.deepEqual(topOf(next), { level: 1, dimension: "skills", focus: null });
  assert.equal(consoleReduce(CONSOLE_ROOT, { type: "replaceTop", entry: { level: 1, dimension: "fit", focus: null } }), CONSOLE_ROOT);
});

test("stepBus walks the desk order and wraps both ways", () => {
  assert.equal(stepBus("skills", 1), "experience");
  assert.equal(stepBus("skills", -1), "fit");
  assert.equal(stepBus("fit", 1), "skills");
  let d = BUS_ORDER[0] as (typeof BUS_ORDER)[number];
  for (let i = 0; i < BUS_ORDER.length; i++) d = stepBus(d, 1) as typeof d;
  assert.equal(d, BUS_ORDER[0]);
});

test("layer keys separate the desk from each soloed bus", () => {
  assert.equal(layerKey({ level: 0 }, 0), "desk");
  assert.notEqual(layerKey({ level: 1, dimension: "trust", focus: null }, 1), layerKey({ level: 1, dimension: "salary", focus: null }, 1));
});

test("desk rows map to buses; row 0 is the scribble strips", () => {
  assert.equal(DESK_ROWS, BUS_ORDER.length + 1);
  assert.equal(busAtRow(0), null);
  for (const b of BUS_ORDER) assert.equal(busAtRow(rowOfBus(b)), b);
});

test("moveDesk clamps to the desk: bus heads exist on bus rows only", () => {
  assert.deepEqual(moveDesk({ row: 2, col: 0 }, "ArrowLeft", 20), { row: 2, col: -1 });
  assert.deepEqual(moveDesk({ row: 0, col: 0 }, "ArrowLeft", 20), { row: 0, col: 0 });
  assert.deepEqual(moveDesk({ row: 1, col: -1 }, "ArrowUp", 20), { row: 0, col: 0 });
  assert.deepEqual(moveDesk({ row: 0, col: 19 }, "ArrowRight", 20), { row: 0, col: 19 });
  assert.deepEqual(moveDesk({ row: DESK_ROWS - 1, col: 3 }, "ArrowDown", 20), { row: DESK_ROWS - 1, col: 3 });
  assert.deepEqual(moveDesk({ row: 3, col: 7 }, "Home", 20), { row: 3, col: -1 });
  assert.deepEqual(moveDesk({ row: 0, col: 7 }, "Home", 20), { row: 0, col: 0 });
  assert.deepEqual(moveDesk({ row: 3, col: 7 }, "End", 12), { row: 3, col: 11 });
  assert.equal(moveDesk({ row: 3, col: 7 }, "Enter", 12), null);
});

test("the solo band is the pressed bus inside the layer box, with a fallback line", () => {
  const box = { top: 100, height: 900 };
  assert.deepEqual(busBand(box, { top: 400, height: 50 }), { top: 300, bottom: 550 });
  const none = busBand(box, null);
  assert.equal(none.top, 240);
  assert.ok(none.top + none.bottom <= box.height);
  assert.deepEqual(busBand(box, { top: 50, height: 0 }), busBand(box, null));
});

test("solo frames open from the band to the whole box and close back onto it", () => {
  const band = { top: 300, bottom: 550 };
  const [a, b] = soloFrames(band, "open");
  assert.match(a, /^inset\(300px 0px 550px 0px/);
  assert.match(b, /^inset\(0px 0px 0px 0px/);
  assert.deepEqual(soloFrames(band, "close"), [b, a]);
});
