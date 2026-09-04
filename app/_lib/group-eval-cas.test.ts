// A group evaluation persists against the cohort it actually ranked.
//
// `saveGroupEval` was an UNCONDITIONAL upsert at the end of a run that spends up to
// eight Python processes and can take minutes. Two runs over the same role — a
// recruiter re-opening the modal while a background `group_eval` task is still
// working, or two recruiters on the same role — both wrote, and the LAST one to
// finish won regardless of which cohort it had ranked. The dedupe key
// (group-eval-dedupe.ts) narrows the window to genuinely different requests; it does
// not close it, because a run that started before a pipeline write still finishes
// after it and still overwrites the newer eval with its stale field.
//
// This is the same defect class `.claude/CLAUDE.md` names for read→compute→write:
// the slow work cannot be inside a transaction (it spawns subprocesses), so the
// write has to re-assert what the read saw. `actOnPipelineEntry`'s `expectedStage`
// is the canonical shape; this is its group-eval twin, keyed on the cohort hash.
//
// Drives the REAL store against a throwaway DB — testing/unit-db.ts MUST be the
// FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { saveGroupEval, getGroupEval, readGroupEvalCohortState } = await import("./group-eval.ts");
const { runGroupEval } = await import("./group-eval-run.ts");

after(() => cleanupUnitDb());

const payload = (marker: string) => ({ marker });

test("a first write with no prior row lands, and records the cohort it ranked", () => {
  const written = saveGroupEval("cas-fresh", "Role", payload("first"), undefined, {
    cohortHash: "3-aaaaaaaa",
    expected: { exists: false, cohortHash: null },
  });
  assert.equal(written, true);
  assert.equal((getGroupEval("cas-fresh")!.payload as { marker: string }).marker, "first");
  assert.deepEqual(readGroupEvalCohortState("cas-fresh"), { exists: true, cohortHash: "3-aaaaaaaa" });
});

test("a run that started with no row is DROPPED when another run got there first", () => {
  saveGroupEval("cas-race", "Role", payload("winner"), undefined, {
    cohortHash: "2-bbbbbbbb",
    expected: { exists: false, cohortHash: null },
  });
  // The slow run: it read "no eval for this role" minutes ago and only now writes.
  const written = saveGroupEval("cas-race", "Role", payload("late-loser"), undefined, {
    cohortHash: "2-cccccccc",
    expected: { exists: false, cohortHash: null },
  });
  assert.equal(written, false, "the late run must not clobber a row it never saw");
  assert.equal((getGroupEval("cas-race")!.payload as { marker: string }).marker, "winner");
});

test("a run is DROPPED when the stored cohort moved under it", () => {
  saveGroupEval("cas-moved", "Role", payload("v1"), undefined, {
    cohortHash: "2-11111111",
    expected: { exists: false, cohortHash: null },
  });
  // A newer run over a CHANGED cohort finished first.
  saveGroupEval("cas-moved", "Role", payload("v2"), undefined, {
    cohortHash: "3-22222222",
    expected: { exists: true, cohortHash: "2-11111111" },
  });
  // Our slow run still believes the row carries the v1 cohort.
  const written = saveGroupEval("cas-moved", "Role", payload("stale"), undefined, {
    cohortHash: "2-11111111",
    expected: { exists: true, cohortHash: "2-11111111" },
  });
  assert.equal(written, false, "a result computed against a cohort that has since moved must be dropped");
  assert.equal((getGroupEval("cas-moved")!.payload as { marker: string }).marker, "v2");
});

test("a re-run over an unchanged cohort still replaces its own row", () => {
  saveGroupEval("cas-rerun", "Role", payload("v1"), undefined, {
    cohortHash: "2-33333333",
    expected: { exists: false, cohortHash: null },
  });
  const written = saveGroupEval("cas-rerun", "Role", payload("v2"), undefined, {
    cohortHash: "2-33333333",
    expected: { exists: true, cohortHash: "2-33333333" },
  });
  assert.equal(written, true, "the happy path — a plain re-run — must still write");
  assert.equal((getGroupEval("cas-rerun")!.payload as { marker: string }).marker, "v2");
});

test("a legacy row (no recorded cohort) is adopted by a run that expected none", () => {
  // Rows written before this column existed read cohort_hash = NULL. A run that
  // read that row sees cohortHash null and must still be able to replace it —
  // otherwise every pre-existing eval becomes permanently unwritable.
  saveGroupEval("cas-legacy", "Role", payload("legacy")); // no CAS: the old call shape
  assert.deepEqual(readGroupEvalCohortState("cas-legacy"), { exists: true, cohortHash: null });
  const written = saveGroupEval("cas-legacy", "Role", payload("fresh"), undefined, {
    cohortHash: "2-44444444",
    expected: { exists: true, cohortHash: null },
  });
  assert.equal(written, true);
  assert.equal((getGroupEval("cas-legacy")!.payload as { marker: string }).marker, "fresh");
});

test("the CAS is per tenant — one team's write never satisfies another team's precondition", () => {
  saveGroupEval("cas-tenant", "Role", payload("team-a"), "workspace", {
    cohortHash: "2-55555555",
    expected: { exists: false, cohortHash: null },
  });
  const written = saveGroupEval("cas-tenant", "Role", payload("team-b"), "ws-other", {
    cohortHash: "2-66666666",
    expected: { exists: false, cohortHash: null },
  });
  assert.equal(written, true, "team B genuinely had no row of its own — the composite key keeps them apart");
  assert.equal((getGroupEval("cas-tenant", "workspace")!.payload as { marker: string }).marker, "team-a");
  assert.equal((getGroupEval("cas-tenant", "ws-other")!.payload as { marker: string }).marker, "team-b");
});

// ---- end to end: the cohort moves while the run is spawning ------------------

test("runGroupEval drops its result when the role's eval moved mid-run", async () => {
  const roleKey = "cas-midrun";
  // Start the run. Its body executes synchronously up to the first await, which is
  // AFTER it reads the role's stored eval — exactly the window a minutes-long run
  // leaves open in production.
  const inFlight = runGroupEval({
    roleKey,
    roleTitle: "Backend Engineer",
    candidates: [
      { entryId: "mr-a", candidateId: null, label: "mr-a", matchScore: 90 },
      { entryId: "mr-b", candidateId: null, label: "mr-b", matchScore: 40 },
    ],
  });

  // Meanwhile the cohort moves and a newer evaluation lands.
  saveGroupEval(roleKey, "Backend Engineer", payload("newer-cohort"), undefined, {
    cohortHash: "9-99999999",
    expected: { exists: false, cohortHash: null },
  });

  const res = await inFlight;
  assert.ok(res.topPick, "the run still returns its result to ITS caller — only the persist is dropped");
  assert.equal(
    (getGroupEval(roleKey)!.payload as { marker?: string }).marker,
    "newer-cohort",
    "the stale run must not overwrite the newer evaluation",
  );
});

test("runGroupEval persists normally when nothing moved", async () => {
  const roleKey = "cas-quiet";
  const res = await runGroupEval({
    roleKey,
    roleTitle: "Backend Engineer",
    candidates: [
      { entryId: "q-a", candidateId: null, label: "q-a", matchScore: 90 },
      { entryId: "q-b", candidateId: null, label: "q-b", matchScore: 40 },
    ],
  });
  const stored = getGroupEval(roleKey);
  assert.ok(stored, "the ordinary path must still persist");
  assert.deepEqual((stored.payload as { comparedIds: string[] }).comparedIds, (res.comparedIds as string[]));
  assert.ok(readGroupEvalCohortState(roleKey).cohortHash, "and it records the cohort it ranked");
});
