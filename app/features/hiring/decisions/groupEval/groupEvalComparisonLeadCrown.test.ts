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
import { buildDimRows, coverageCount, rowLeader } from "@/app/features/hiring/decisions/groupEval/groupEvalHelpers";
import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(DIR, "GroupEvalComparisonTable.tsx"), "utf8");
// The candidate-header cell (KO pill vs. Lead crown) lives in the table module itself.
// It was once split into a GroupEvalComparisonRows.tsx, and this guard kept reading THAT
// file after the table re-inlined its own copy — so the KO-before-crown invariant was
// being pinned on a module nothing imported (which still carried the pre-fix sentinel
// row-leader too). The orphan is gone; both assertions read the live component.
const headerSrc = src;

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

// The must-have coverage row is the table's third comparative claim ("2/4 must-haves"),
// and it counted an ABSENT assessment as a measured zero. The enriched table renders as
// soon as ONE column has a breakdown, so a candidate the ranker returned no row for sits
// beside fully-assessed rivals — and was shown a red "0/4" they never earned, directly
// contradicting the neutral "not applicable" dashes SkillCell draws for the same skills.
const cand = (label: string, fields: Partial<EvalCandidate> = {}): EvalCandidate => ({ label, score: 70, seniority: null, verdict: "", strengths: [], gaps: [], ...fields }) as EvalCandidate;
const MUST = ["Kafka", "Go"];

test("an UNASSESSED candidate reports no must-have coverage — never a fabricated 0/N", () => {
  assert.equal(coverageCount(cand("Bo"), MUST), null, "no skill assessment at all is absent, not zero");
});

test("a MEASURED zero still counts as zero (absent ≠ zero, REC-03)", () => {
  assert.equal(coverageCount(cand("Cyril", { matchedSkills: [], missingSkills: MUST }), MUST), 0);
  assert.equal(coverageCount(cand("Ada", { matchedSkills: ["Kafka"], missingSkills: ["Go"] }), MUST), 1);
  assert.equal(coverageCount(cand("Eva", { matchedSkills: ["Kafka", "Go"] }), MUST), 2);
});

test("an absent coverage count cannot win or lose the coverage row", () => {
  const assessed = cand("Ada", { matchedSkills: ["Kafka"], missingSkills: ["Go"] });
  const unassessed = cand("Bo");
  // One measured value among absent ones is not a lead — and, crucially, the absent
  // column is no longer washed as a "0" loser either.
  assert.equal(rowLeader([coverageCount(assessed, MUST), coverageCount(unassessed, MUST)]), null);
  const measuredZero = cand("Cyril", { matchedSkills: [], missingSkills: MUST });
  assert.equal(rowLeader([coverageCount(assessed, MUST), coverageCount(measuredZero, MUST)]), 1);
});

// The score-breakdown row head is the table's fourth claim ("SKILLS · weight 50%"), and
// both halves of it are PER-CANDIDATE facts: matching.dimension_labels renames the slots
// for early-career archetypes (skills→Foundation) and matching.WEIGHTS weights them
// differently (skills = 50% bau / 40% student / 35% career_switcher). Taking both from
// the first column headed a mixed field's row with one candidate's rename and one
// candidate's weight.
const dim = (key: string, label: string, labelCode: string, weight: number) => ({ key, label, labelCode, percent: 60, weight, contribution: 30 });
const withDims = (label: string, dims: ReturnType<typeof dim>[]) => cand(label, { scoreBreakdown: dims } as Partial<EvalCandidate>);
const BAU = [dim("skills", "Skills", "skills", 50), dim("career", "Career", "career", 35)];
const STUDENT = [dim("skills", "Foundation", "foundation", 40), dim("career", "Potential", "potential", 40)];

test("a single-archetype field keeps its own labels and weights", () => {
  assert.deepEqual(buildDimRows([withDims("Ada", BAU), withDims("Bo", BAU)]), [
    { key: "skills", label: "Skills", labelCode: "skills", weight: 50 },
    { key: "career", label: "Career", labelCode: "career", weight: 35 },
  ]);
});

// The old inline derivation, kept here as the regression's exact shape.
const oldDims = (cands: EvalCandidate[]) => {
  const seen = new Set<string>();
  const out: { key: string; label: string; weight: number }[] = [];
  for (const c of cands) for (const d of c.scoreBreakdown ?? []) if (!seen.has(d.key)) { seen.add(d.key); out.push({ key: d.key, label: d.label, weight: d.weight }); }
  return out;
};

test("a MIXED field states no weight it doesn't share and no archetype's rename", () => {
  const field = [withDims("Eva", STUDENT), withDims("Ada", BAU)];
  assert.deepEqual(oldDims(field)[0], { key: "skills", label: "Foundation", weight: 40 }, "the regression: the first column's rename and weight headed the whole row");
  const rows = buildDimRows(field);
  assert.deepEqual(rows[0], { key: "skills", label: "skills", labelCode: "skills", weight: null }, "50% vs 40% is not a row-level weight, and 'Foundation' is not a row-level name");
  assert.deepEqual(rows[1], { key: "career", label: "career", labelCode: "career", weight: null });
  // The canonical fallback is the dimension's own catalog code, so it still localizes.
  assert.equal(rows[0].labelCode, rows[0].key);
});

test("the row order is the union in first-seen (rank) order, and a missing breakdown adds nothing", () => {
  const rows = buildDimRows([cand("NoRow"), withDims("Ada", BAU), withDims("Eva", [dim("personal", "Fit", "fit", 20)])]);
  assert.deepEqual(rows.map((r) => r.key), ["skills", "career", "personal"]);
  assert.equal(rows[2].weight, 20, "a dimension only ONE candidate carries keeps that candidate's weight");
});

test("the KO pill takes precedence over the Lead crown in the header ternary", () => {
  // The KO must be checked BEFORE isLead so a KO candidate can never be crowned and
  // the crown can never mask the KO pill. The predicate is the SHARED koFailed()
  // helper (groupEvalHelpers.ts), which the legacy view renders from too — the two
  // views state one rule, not two copies of it.
  const koIdx = headerSrc.indexOf("koFailed(c) ? (");
  const leadIdx = headerSrc.indexOf(": isLead ? (");
  assert.ok(koIdx >= 0 && leadIdx >= 0, "both branches must exist");
  assert.ok(koIdx < leadIdx, "the koFailed branch must come before the isLead branch");
});
