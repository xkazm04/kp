// The kit's ONE way to set a number (kit.js fig): locale digits, "—" for an absence (never 0),
// a real minus sign on a falling delta, a clamped drawn share, and the class a needing figure
// or an absent one wears.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { ABSENT, figureClass, figureDelta, figureDraw, figureValue } from "./figure.ts";

test("a null value is an absence, printed as an em dash, never as 0", () => {
  assert.equal(figureValue(null, "en"), ABSENT);
  assert.equal(figureValue(0, "en"), "0");
});

test("numbers follow the reader's locale; strings pass through", () => {
  assert.equal(figureValue(1131, "en"), "1,131");
  assert.equal(figureValue(1131, "de"), "1.131");
  assert.equal(figureValue("3d", "cs"), "3d");
});

test("delta: up needs you, down is good, with a real minus sign; zero draws nothing", () => {
  assert.deepEqual(figureDelta(3, "en"), { text: "+3", dir: "up" });
  assert.deepEqual(figureDelta(-2, "en"), { text: "−2", dir: "down" });
  assert.equal(figureDelta(0, "en"), null);
  assert.equal(figureDelta(undefined, "en"), null);
});

test("draw is a clamped percentage; no draw, no bar", () => {
  assert.equal(figureDraw(0.25), "25.0%");
  assert.equal(figureDraw(1.4), "100.0%");
  assert.equal(figureDraw(-1), "0.0%");
  assert.equal(figureDraw(undefined), null);
  assert.equal(figureDraw(Number.NaN), null);
});

test("class: needs is coral, absent is faint, a changed figure rolls once", () => {
  assert.equal(figureClass({ value: 3, tone: "needs" }), "k-fig k-fig--needs");
  assert.equal(figureClass({ value: null }), "k-fig k-fig--absent");
  assert.equal(figureClass({ value: 1 }, true), "k-fig is-rolling");
});
