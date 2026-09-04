// The SSR / no-DOM half of text measurement had no test at all, and it is the
// half that runs in every unit test and every server render: `measure()` sizes
// the boxes layout.ts lays out, so if the fallback ever returned 0 (or NaN)
// every node would collapse to its minimum width with no error anywhere.
//
// Under `node --test` there is no `document`, so these run the fallback branch
// by construction — that is the point, not a limitation.
//   npm run test:unit -- app/_components/puml/measure.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, measureLines } from "./measure.ts";
import { NODE_FONT, TITLE_FONT } from "./constants.ts";

test("no-DOM fallback estimates width per character, deterministically", () => {
  assert.equal(typeof document, "undefined", "this file must exercise the SSR branch");
  const a = measure("abcdefghij");
  assert.ok(Number.isFinite(a) && a > 0, `expected a finite positive width, got ${a}`);
  // Same input, same answer — the cached context must not make it drift.
  assert.equal(measure("abcdefghij"), a);
  // Longer text is wider: the property layout.ts actually depends on.
  assert.ok(measure("abcdefghijklmnop") > a);
  assert.equal(measure(""), 0);
});

test("the fallback ignores the font (it has no metrics to differ by)", () => {
  // Honest pin of the CURRENT contract: with no canvas there is nothing to
  // distinguish 500 from 600 weight, so both fonts must agree rather than one
  // silently returning undefined.
  assert.equal(measure("Interview", TITLE_FONT), measure("Interview", NODE_FONT));
});

test("measureLines returns the widest line, not the sum", () => {
  const lines = ["short", "a considerably longer line", "mid"];
  assert.equal(measureLines(lines), measure("a considerably longer line"));
  // A single line degenerates to measure(); no lines is a zero-width label.
  assert.equal(measureLines(["solo"]), measure("solo"));
  assert.equal(measureLines([]), 0);
});
