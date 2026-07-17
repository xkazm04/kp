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

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "ComparisonTable.tsx"), "utf8");

test("the Lead crown is gated on a server-crowned lead, not column position", () => {
  assert.match(src, /isLead=\{hasLead && i === 0\}/, "isLead must require hasLead, not be a bare i === 0");
  assert.doesNotMatch(src, /isLead=\{i === 0\}/, "the old positional crown must be gone");
});

test("the KO pill takes precedence over the Lead crown in the header ternary", () => {
  // koPassed === false must be checked BEFORE isLead so a KO candidate can never be
  // crowned and the crown can never mask the KO pill.
  const koIdx = src.indexOf("c.koPassed === false ? (");
  const leadIdx = src.indexOf(": isLead ? (");
  assert.ok(koIdx >= 0 && leadIdx >= 0, "both branches must exist");
  assert.ok(koIdx < leadIdx, "the koPassed === false branch must come before the isLead branch");
});
