// The comparison table must not crown a lead the server didn't crown
// (group-evaluation-fairness #1). It used to render isLead={i === 0} — pure column
// position — so an all-KO or sub-min-cohort field (server topPick: null) still
// showed a moss "Lead" crown on column 1, and because the pill ternary checked
// isLead first, that candidate's KO pill was suppressed by the phantom crown. The
// table is a client component with no unit seam, so this pins the two invariants in
// source: the crown is gated on a real lead, and KO always wins the pill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rowLeader } from "./helpers.ts";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComparisonTable.tsx"), "utf8");

test("the Lead crown is gated on a server-crowned lead, not column position", () => {
  assert.match(src, /isLead=\{hasLead && i === 0\}/, "isLead must require hasLead, not be a bare i === 0");
  assert.doesNotMatch(src, /isLead=\{i === 0\}/, "the old positional crown must be gone");
});

// The per-ROW leader wash is the table's second lead claim, and it used to be just as
// positional: absent values were mapped to a -1 SENTINEL and compared with
// `leader > -Infinity`, so an all-unscored (or exactly tied) row painted the moss
// row-winner wash on EVERY column — contradicting the very comment that said "an
// absent score can never win the row".
test("an all-unscored row crowns nobody — no column gets the leader wash", () => {
  assert.equal(rowLeader([null, null, null]), null);
});

test("an exactly-tied row crowns nobody", () => {
  assert.equal(rowLeader([70, 70, 70]), null);
  assert.equal(rowLeader([0, 0]), null);
});

test("an absent value never wins a row that someone measured", () => {
  assert.equal(rowLeader([null, 41, 12]), 41);
  // A genuine 0 is a MEASURED value and competes normally — it just loses (REC-03).
  assert.equal(rowLeader([null, 0, 12]), 12);
});

test("a single measured value among absent ones leads nothing", () => {
  // One number and nothing to compare it against is not a lead: the wash claims "this
  // column beat the others", and an unscored column was never in the race.
  assert.equal(rowLeader([null, 80]), null);
  assert.equal(rowLeader([null, 0]), null);
});

test("a shared lead at the top of a discriminating row keeps the wash on both", () => {
  assert.equal(rowLeader([70, 70, 60]), 70);
});

test("the row leader uses the null-based helper, not the -1 / -Infinity sentinel", () => {
  assert.match(src, /rowLeader\(candidates\.map\(leaderValue\)\)/, "the row must delegate to rowLeader");
  assert.doesNotMatch(src, /\?\? -1/, "the -1 absent-value sentinel must be gone");
  assert.doesNotMatch(src, /leader > -Infinity/, "the sentinel comparison must be gone");
});

test("the KO pill takes precedence over the Lead crown in the header ternary", () => {
  // koPassed === false must be checked BEFORE isLead so a KO candidate can never be
  // crowned and the crown can never mask the KO pill.
  const koIdx = src.indexOf("c.koPassed === false ? (");
  const leadIdx = src.indexOf(": isLead ? (");
  assert.ok(koIdx >= 0 && leadIdx >= 0, "both branches must exist");
  assert.ok(koIdx < leadIdx, "the koPassed === false branch must come before the isLead branch");
});
