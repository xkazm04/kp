// FlowTable (Gate 1): the short editable table in flow. Pins the row's class list (a list row plus
// the draft edges), the grid variables its head and rows share (the meta split and its two fold
// steps, the same maths DataTable uses), that kit.css styles every class it emits, and that the
// "shown only when folded" rule sits AFTER the fold steps so the foldOrder test's slice is intact.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flowRowClass, flowVars } from "./flow.ts";

const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");

test("a flow row is a table row and a list row; draft states add their edge", () => {
  assert.equal(flowRowClass([], false), "k-table__row k-row k-flow__row");
  assert.equal(flowRowClass(["changed", "error"], true), "k-table__row k-row k-flow__row has-detail is-changed is-error");
  for (const cls of [".k-table__row.k-flow__row {", ".k-flow__row.is-changed {", ".k-flow__row.is-error {", ".k-flow__detail {"]) {
    assert.ok(css.includes(cls), cls);
  }
});

test("the head and rows fold like DataTable: meta+N first, then meta", () => {
  const v = flowVars("minmax(0,1fr) 150px");
  assert.equal(v["--t-meta"], "minmax(0,1fr) 150px");
  assert.equal(v["--t-meta1"], "minmax(0,1fr) 0px");
  assert.equal(v["--t-meta0"], "0px 0px");
  assert.equal(v["--t-name"], undefined, "the measure's own name track unless asked");
  assert.equal(flowVars(undefined, "minmax(0, 20%)")["--t-name"], "minmax(0, 20%)");
});

test("a control shown only when folded appears at the first fold step, after the fold rules", () => {
  assert.match(css, /\.k-show-folded \{ display: none; \}/);
  const last = css.lastIndexOf("@container sheet (max-width: 1000px)");
  assert.ok(last > css.indexOf("@container sheet (max-width: 860px)"), "declared after the fold steps");
  assert.match(css.slice(last), /\.k-show-folded \{ display: contents; \}/);
});
