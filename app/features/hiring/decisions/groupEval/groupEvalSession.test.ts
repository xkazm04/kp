import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageNote, decideWith, isEnriched, mergeSealed } from "./groupEvalSession.ts";
import { buildSkillRows, koFailed } from "./groupEvalHelpers.ts";
import type { EvalCandidate, GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// group-eval-tabs-and-legacy-tell-the-same-truth (c)/(e): the rules that decide
// WHICH view the modal shows, which decisions it may claim as recorded, and which
// coverage sentence it prints were all untested — they lived inline in a hook and
// in a component body. They are pure, so they are pinned here.

const cand = (over: Partial<EvalCandidate> = {}): EvalCandidate => ({
  label: "Ada",
  score: 71,
  seniority: null,
  verdict: "",
  strengths: [],
  gaps: [],
  ...over,
});

// ---- (e) sealed merge + decide contract ----------------------------------

test("a sealed decision wins over the session map — never a live button over a sealed reject", () => {
  const merged = mergeSealed({ e1: "accept" }, { e1: "reject", e2: "reject" });
  assert.deepEqual(merged, { e1: "reject", e2: "reject" });
});

test("with nothing sealed the session map is returned unchanged (same reference)", () => {
  const decided = { e1: "accept" as const };
  assert.equal(mergeSealed(decided, undefined), decided);
});

test("decide records ONLY what the pipeline actually applied", () => {
  const applied = decideWith({}, () => true);
  assert.equal(applied("e1", "accept"), "accept");
  // onDecide returned false: the candidate has left the live pool, so nothing was
  // recorded and the buttons must stay live for a retry (never a fake success pill).
  const refused = decideWith({}, () => false);
  assert.equal(refused("e1", "accept"), null);
});

test("an already-decided identity is not re-acted on — and onDecide is not even called", () => {
  let calls = 0;
  const decide = decideWith({ e1: "reject" }, () => {
    calls += 1;
    return true;
  });
  assert.equal(decide("e1", "accept"), null);
  assert.equal(calls, 0);
});

// ---- (e) enriched threshold ----------------------------------------------

test("the enriched table needs ONE real breakdown; empty arrays are not one", () => {
  assert.equal(isEnriched([]), false);
  assert.equal(isEnriched([cand(), cand()]), false);
  assert.equal(isEnriched([cand({ scoreBreakdown: [] })]), false);
  assert.equal(
    isEnriched([cand(), cand({ scoreBreakdown: [{ key: "skills", label: "Skills", percent: 75, weight: 0.4, contribution: 30 }] })]),
    true
  );
});

// ---- (e) coverage note exclusivity ---------------------------------------

const payload = (over: Partial<GroupEvalPayload>): GroupEvalPayload => ({ ...over }) as GroupEvalPayload;

test("an explicit selection discloses the selection note and NEVER the capped note", () => {
  const note = coverageNote(payload({ selection: { count: 4, total: 11 }, capped: true, cap: 8, totalCandidates: 11 }));
  assert.deepEqual(note, { kind: "selection", count: 4, total: 11 });
});

test("a capped default run discloses the top-N coverage", () => {
  assert.deepEqual(coverageNote(payload({ capped: true, cap: 8, totalCandidates: 11 })), { kind: "capped", cap: 8, total: 11 });
});

test("a capped run with no cap recorded falls back to the compared count, never 0/0", () => {
  assert.deepEqual(coverageNote(payload({ capped: true, candidates: [cand(), cand()], totalCandidates: 5 })), {
    kind: "capped",
    cap: 2,
    total: 5,
  });
});

test("an uncapped full-cohort run says nothing", () => {
  assert.equal(coverageNote(payload({ capped: false })), null);
  assert.equal(coverageNote(payload({ selection: null })), null);
});

// ---- (c) the KO rule is ONE rule ----------------------------------------

test("koFailed is explicit-false only — an absent flag was never assessed", () => {
  assert.equal(koFailed(cand({ koPassed: false })), true);
  assert.equal(koFailed(cand({ koPassed: true })), false);
  assert.equal(koFailed(cand()), false);
});

// ---- (e) skill rows -------------------------------------------------------

test("declared requirements drive the rows, must-haves first then alphabetical", () => {
  const { rows, mustRows } = buildSkillRows(
    [cand()],
    [
      { skill: "Kubernetes", kind: "nice_to_have" },
      { skill: "Go", kind: "must_have" },
      { skill: "Ansible", kind: "nice_to_have" },
      { skill: "AWS", kind: "must_have" },
    ]
  );
  assert.deepEqual(
    rows.map((r) => r.skill),
    ["AWS", "Go", "Ansible", "Kubernetes"]
  );
  assert.deepEqual(mustRows, ["AWS", "Go"]);
});

test("with no requirements the rows are the union of the compared skills, and a MISSING skill is a must-have", () => {
  const { rows, mustRows } = buildSkillRows(
    [cand({ matchedSkills: ["Go", "SQL"] }), cand({ label: "Bo", matchedSkills: ["Go"], missingSkills: ["Rust"] })],
    []
  );
  assert.deepEqual(
    rows.map((r) => r.skill),
    ["Rust", "Go", "SQL"]
  );
  assert.deepEqual(mustRows, ["Rust"]);
});

test("a candidate with no assessment at all contributes no rows", () => {
  assert.deepEqual(buildSkillRows([cand()], []), { rows: [], mustRows: [] });
});
