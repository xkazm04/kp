// bug-ui-scan-2026-07-09 #4 (end-to-end): a SINGLE-candidate group eval must NOT crown or
// auto-seal a lead, must NOT claim robustness, and must report "insufficient sample".
//
// NON-VACUITY: pre-fix, runGroupEval with one candidate set `lead = top`, sealed a
// `group_eval_lead`, and set robustness via assessRobustness(false, null) === "not_applicable"
// with a non-null topPick. The three assertions in the n=1 test below (no lead sealed,
// robustness === "insufficient_sample", topPick === null) each FAIL against that. The n=2
// test pins that a genuine field still crowns + seals a lead, so the floor didn't break the
// happy path.
//
// Drives the REAL runGroupEval against a throwaway DB — testing/unit-db.ts MUST be the
// FIRST project import (it sets KP_DB_PATH before any db-path import). Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Force the best-effort AI "compare all" spawn to fail fast (ENOENT → deterministic
// fallback), so the test is hermetic. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");
const { listDecisionRecords } = await import("./decision-record-store.ts");
const { saveProfile } = await import("./db/profiles.ts");

after(() => cleanupUnitDb());

const candidate = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });
const sealedKinds = (entryId: string) => listDecisionRecords({ candidateRef: entryId }).map((r) => r.kind);

test("a single-candidate field is insufficient sample — no lead crowned, sealed, or robustness-claimed", async () => {
  const entryId = "solo-entry";
  const res = await runGroupEval({
    roleKey: "role-solo",
    roleTitle: "Backend Engineer",
    candidates: [candidate(entryId, 90)],
    governanceMode: "recommendation",
  });
  assert.equal(res.robustness, "insufficient_sample", "robustness must report insufficient sample, not a trivial pass");
  assert.equal(res.topPick, null, "no lead is crowned for a field of one");
  assert.deepEqual(res.differentiators, [], "no 'unique strengths' for a field of one");
  assert.match(String(res.summary), /insufficient sample/i);
  const kinds = sealedKinds(entryId);
  assert.ok(!kinds.includes("group_eval_lead"), `a single candidate must NOT auto-seal a lead, got [${kinds.join(", ")}]`);
  assert.ok(!kinds.includes("group_eval_advisory"), `nor an advisory record, got [${kinds.join(", ")}]`);
});

test("a two-candidate field clears the floor — a lead is crowned and sealed", async () => {
  const lead = "duo-lead";
  const res = await runGroupEval({
    roleKey: "role-duo",
    roleTitle: "Backend Engineer",
    candidates: [candidate(lead, 90), candidate("duo-rival", 40)],
    governanceMode: "recommendation",
  });
  assert.notEqual(res.robustness, "insufficient_sample", "a real field is comparable");
  assert.ok(res.topPick, "a lead is crowned once the field clears the floor");
  // The crown carries the lead's stable IDENTITY, not just its (non-unique) display
  // label — the modal keys the lead's "Unique strengths" chips on it, so with two
  // same-named candidates the label alone decorated the rival's tab.
  assert.equal((res.topPick as { entryId?: string }).entryId, lead, "topPick must carry the lead's entryId");
  const kinds = sealedKinds(lead);
  assert.ok(kinds.includes("group_eval_lead"), `recommendation over a real field auto-seals a lead, got [${kinds.join(", ")}]`);
});

// ---- The floor also gates the AI narrative (scan-sweep) --------------------
//
// group_compare's deterministic twin has an explicit n==1 branch ("**Ada** leads 1
// candidate … on overall fit (**90**)" / "Advance **Ada** — the only candidate in this
// role"), and GroupEvalModal's AiVerdict renders the narrative INSTEAD of `summary`
// whenever one exists. So a single-candidate eval crowned no lead, sealed nothing and
// wrote "insufficient sample" into `summary` — and then showed the recruiter an AI
// headline crowning that candidate anyway, with the disclosure nowhere on screen. It
// also spent a paid LLM round-trip comparing one candidate against nobody.
//
// The spawn is asserted through its own failure log (PYTHON_CMD is bogus here, so an
// ATTEMPTED narrative always warns). NON-VACUITY: pre-fix the n=1 run warns exactly
// once — the first assertion FAILS; the n=2 half pins that a real field still asks.
test("the min-cohort floor also gates the AI 'compare all' spawn (no LLM spend on a field of one)", async () => {
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.map((a) => String(a)).join(" "));
  const attempts = () => warnings.filter((w) => w.includes("[group-eval] compare summary failed")).length;
  try {
    const solo = await runGroupEval({
      roleKey: "role-solo-compare",
      roleTitle: "Backend Engineer",
      candidates: [candidate("solo-compare", 90)],
      governanceMode: "recommendation",
    });
    assert.equal(attempts(), 0, "a field of one must not even attempt the head-to-head narrative");
    // …so AiVerdict has no comparison to prefer and falls back to the honest summary.
    assert.equal(solo.comparison, null);
    assert.match(String(solo.summary), /insufficient sample/i);

    warnings.length = 0;
    const duo = await runGroupEval({
      roleKey: "role-duo-compare",
      roleTitle: "Backend Engineer",
      candidates: [candidate("duo-compare-a", 90), candidate("duo-compare-b", 40)],
      governanceMode: "recommendation",
    });
    assert.equal(attempts(), 1, "a comparable field still asks for the narrative");
    assert.equal(duo.comparison, null, "…and degrades to the deterministic summary when the spawn fails");
  } finally {
    console.warn = realWarn;
  }
});

// ---- The fairness TRACK reaches the persisted eval (scan-sweep) ------------
//
// pipeline/jobfit/recruiter.py states the contract: an early-career candidate's
// `career` slot scores POTENTIAL (readiness) while an experienced one's scores
// work-history fit — "two incomparable 0-100 scales … they must never be ranked against
// each other on one total" — and it stamps `track` on every ranked row "so any consumer
// … can split early-career from experienced". runGroupEval dropped the field on the
// floor: nothing downstream of the eval could tell a mixed field from a homogeneous
// one, because the persisted candidates carried no track at all.
//
// NON-VACUITY: pre-fix `candidates[i].track` is `undefined` for every candidate, so
// BOTH assertions below fail. (Whether the UI then GROUPS by track or merely discloses
// the mixed field is a product decision for the modal — this pins the server half: the
// fact is now on the record.)
test("every compared candidate carries its fairness track (early_career vs experienced)", async () => {
  // No job/ranker here, so the track comes from the archetype via the SAME rule
  // recruiter.fairness_track applies — which is what a job-less role must fall back to.
  const student = saveProfile({
    label: "Ada Lovelace",
    archetype: "student",
    roleFamily: null,
    completeness: null,
    payload: { archetype: "student", seniority: "junior" },
  });
  const senior = saveProfile({
    label: "Grace Hopper",
    archetype: "bau",
    roleFamily: null,
    completeness: null,
    payload: { archetype: "bau", seniority: "senior" },
  });
  const res = await runGroupEval({
    roleKey: "role-track",
    roleTitle: "Backend Engineer",
    candidates: [
      { entryId: "tr-student", candidateId: student.id, label: "Ada Lovelace", matchScore: 90 },
      { entryId: "tr-senior", candidateId: senior.id, label: "Grace Hopper", matchScore: 80 },
      // No candidateId and no profile ⇒ no archetype was ever detected. An unknown
      // track must stay null, never default into "experienced".
      { entryId: "tr-unrouted", candidateId: null, label: "Anon", matchScore: 70 },
    ],
    governanceMode: "recommendation",
  });
  const byEntry = new Map(
    (res.candidates as { entryId: string; track: string | null }[]).map((c) => [c.entryId, c.track])
  );
  assert.equal(byEntry.get("tr-student"), "early_career", "a student is scored on potential — its own track");
  assert.equal(byEntry.get("tr-senior"), "experienced");
  assert.equal(byEntry.get("tr-unrouted"), null, "an unrouted candidate's track is unknown, not 'experienced'");
});
