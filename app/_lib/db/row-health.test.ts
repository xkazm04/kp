// The decode seam's contract, pinned.
//
// Governing standard: the registry's `data-access` subject and its `row-mapping`
// technique. Two clauses drive every assertion here:
//
//   "A collection read has exactly two legal answers ... What is banned is the third
//    option every codebase drifts into: skipping SILENTLY."
//   "Single-record reads fail loud. 'No such record' and 'record exists but cannot be
//    decoded' are different facts and must not share the empty answer."
//
// safeRowParse already logged before this seam existed, so the console half was fine.
// What it could not do was COUNT — and an uncounted skip is only visible to whoever
// happens to be reading stderr. These tests pin the counting, because that is what
// makes a silent skip structurally unavailable rather than merely discouraged.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store opens
// a throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readRowColumn, safeRowParse, getRowHealth, __resetRowHealth } from "./core.ts";

after(() => cleanupUnitDb());
beforeEach(() => __resetRowHealth());

/** Minimal zod-shaped validator — proves the seam needs no zod dependency of its own. */
const wantsName = {
  safeParse(value: unknown) {
    const v = value as { name?: unknown } | null;
    return typeof v?.name === "string"
      ? ({ success: true, data: v as { name: string } } as const)
      : ({ success: false, error: { issues: [{ path: ["name"], message: "expected string" }] } } as const);
  },
};

test("absent and unreadable are different answers, and absent is not an error", () => {
  assert.deepEqual(readRowColumn(null, "t.absent", "row-1"), { state: "absent" });
  assert.deepEqual(readRowColumn(undefined, "t.absent", "row-2"), { state: "absent" });
  assert.equal(getRowHealth().total, 0, "a NULL column is a legitimate value, never a health issue");

  const bad = readRowColumn("{not json", "t.corrupt", "row-3");
  assert.equal(bad.state, "unreadable");
  assert.equal(bad.state === "unreadable" && bad.reason, "corrupt");
});

test("a corrupt column is COUNTED, not merely logged", () => {
  readRowColumn("{{{", "t.corrupt", "row-7");
  const health = getRowHealth();
  assert.equal(health.total, 1);
  assert.equal(health.ok, false);
  assert.equal(health.issues[0].ctx, "t.corrupt");
  assert.equal(health.issues[0].id, "row-7", "the row's identity is recorded — a skip with no identity is unactionable");
  assert.equal(health.issues[0].reason, "corrupt");
});

test("a shape mismatch is a distinct, recorded reason and names the offending path", () => {
  const r = readRowColumn(JSON.stringify({ name: 42 }), "t.shape", "row-9", wantsName);
  assert.equal(r.state, "unreadable");
  assert.equal(r.state === "unreadable" && r.reason, "invalid");
  const issue = getRowHealth().issues[0];
  assert.equal(issue.reason, "invalid");
  assert.match(issue.detail, /name/, "the detail must name the failing field, or the report cannot be acted on");
});

test("well-formed JSON of the WRONG SHAPE is caught — the drift the type-only import could not see", () => {
  // The whole point of wiring the generated schemas: this payload parses fine and would
  // have sailed through as a valid T before the validator existed.
  const r = readRowColumn(JSON.stringify({ nmae: "typo" }), "t.drift", "row-11", wantsName);
  assert.equal(r.state, "unreadable");
  assert.equal(getRowHealth().total, 1);
});

test("observe mode records the mismatch AND returns the value", () => {
  const r = readRowColumn(JSON.stringify({ name: 42 }), "t.observe", "row-13", wantsName, "observe");
  assert.equal(r.state, "ok", "observe hands the value on — it is a migration posture, not enforcement");
  assert.equal(getRowHealth().total, 1, "but the mismatch is still counted; observe is not silence");
  assert.equal(getRowHealth().issues[0].reason, "invalid");
});

test("safeRowParse is unchanged for its existing callers, and still feeds the ledger", () => {
  assert.equal(safeRowParse<{ a: number }>(JSON.stringify({ a: 1 }), "t.ok", "row-15")?.a, 1);
  assert.equal(safeRowParse(null, "t.null", "row-16"), null);
  assert.equal(getRowHealth().total, 0, "healthy reads and NULL columns leave the ledger clean");

  assert.equal(safeRowParse("]]", "t.bad", "row-17"), null, "corrupt still collapses to null for the 76 legacy callers");
  assert.equal(getRowHealth().total, 1, "...but is now counted, which it was not before");
});

test("the ledger keeps a bounded sample without losing the total", () => {
  for (let i = 0; i < 120; i++) readRowColumn("{oops", "t.flood", `row-${i}`);
  const health = getRowHealth();
  assert.equal(health.total, 120, "the count survives a flood");
  assert.ok(health.issues.length <= 50, `retained sample stays bounded, saw ${health.issues.length}`);
  assert.equal(health.issues.at(-1)?.id, "row-119", "the sample keeps the most recent");
});

// Non-vacuity: a healthy read must leave no trace, or every assertion above would pass
// against a seam that simply records everything unconditionally.
test("a healthy validated read records nothing", () => {
  const r = readRowColumn(JSON.stringify({ name: "ok" }), "t.clean", "row-21", wantsName);
  assert.equal(r.state, "ok");
  assert.deepEqual(getRowHealth(), { ok: true, total: 0, issues: [] });
});
