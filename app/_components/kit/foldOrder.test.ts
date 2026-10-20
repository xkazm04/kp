// The measure's collapse order is a KIT rule: meta+N -> meta -> act, and mark, name, fig and
// time never fold. Pinned twice: the track -> step mapping the DataTable stamps on its cells
// (tracks.ts), and kit.css itself, whose container queries must fold the steps in that order
// (a later @container block wins, so the 1000px step has to come BEFORE the 860px one).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FOLD_AT, FOLD_ORDER, foldClass, foldStep } from "./tracks.ts";

test("the fold order is meta+N, then meta, then act; the other four tracks never fold", () => {
  assert.deepEqual(FOLD_ORDER, ["meta+N", "meta", "act"]);
  assert.equal(foldStep("meta+1"), 0);
  assert.equal(foldStep("meta+2"), 0);
  assert.equal(foldStep("meta"), 1);
  assert.equal(foldStep("act"), 2);
  for (const t of ["mark", "name", "fig", "time"] as const) assert.equal(foldStep(t), null, t);
  assert.ok(FOLD_AT["meta+N"] > FOLD_AT.meta, "the extras fold at a WIDER sheet than meta itself");
});

test("a meta+N cell folds at step 1 and stays folded with meta at step 2", () => {
  assert.equal(foldClass("meta+1"), " in-meta in-meta-x");
  assert.equal(foldClass("meta"), " in-meta");
  assert.equal(foldClass("act"), " in-act");
  assert.equal(foldClass("name"), "");
});

test("kit.css folds the steps in order at the declared widths", () => {
  const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");
  const at1000 = css.indexOf("@container sheet (max-width: 1000px)");
  const at860 = css.indexOf("@container sheet (max-width: 860px)");
  assert.ok(at1000 > 0 && at860 > at1000, "the 1000px step precedes the 860px step");
  const step1 = css.slice(at1000, at860);
  assert.match(step1, /--t-meta-cur: var\(--t-meta1\)/);
  assert.match(step1, /\.k-td\.in-meta-x, \.k-th\.in-meta-x \{ visibility: hidden; \}/);
  assert.doesNotMatch(step1, /\.k-td\.in-meta[,\s]/, "meta itself does not fold at step 1");
  const step2 = css.slice(at860, css.indexOf("}\n", css.indexOf(".k-folded-note { display: block", at860)));
  assert.match(step2, /--t-meta-cur: var\(--t-meta0\)/);
  assert.match(step2, /--m-act-cur: 0px/);
});
