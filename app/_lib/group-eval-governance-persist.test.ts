// bug-ui-scan-2026-07-09 #1: the group-eval governance mode must be PERSISTED per
// role and resolved SERVER-SIDE, so a committee / eligibility-list role can never
// silently downgrade to "recommendation" and auto-seal a solely-automated AI lead.
//
// The reported defect: `evalMode` is unpersisted per-mount client state that resets to
// "recommendation" on every fresh mount / different user / rerun, and runGroupEval
// trusted that per-request param. So re-opening/rerunning a governed role re-sends
// "recommendation", sealsLead("recommendation") is true, and the run seals a
// `group_eval_lead` decision on a role whose governance requires the AI to stay advisory.
//
// This drives the REAL runGroupEval + the isolated group_evals / decision_records stores
// against a throwaway DB (testing/unit-db.ts must be the FIRST project import — it sets
// KP_DB_PATH via mkdtempSync before any db-path import). Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { resolveGovernanceMode } from "./group-eval-governance.ts";

// Force the best-effort AI "compare all" spawn (runGroupCompare → group_compare_cli)
// to fail fast so this test is hermetic + quick: it catches the ENOENT and returns
// null, leaving the deterministic summary — the governance/seal path under test is
// unaffected. Set BEFORE python-runner is loaded (it reads PYTHON_CMD at module
// eval), so runGroupEval is pulled in via a dynamic import below the assignment.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");
const { getGroupEval } = await import("./group-eval.ts");
const { listDecisionRecords } = await import("./decision-record-store.ts");

after(() => cleanupUnitDb());

// A job-less, profile-less candidate with a stored match score: enough to crown +
// (in recommendation mode) auto-seal a lead, with no ranker/reasoning Python needed.
const candidate = (entryId: string) => ({ entryId, candidateId: null, label: "Ada Byron", matchScore: 90 });
// A lower-scored rival so the field clears the min-cohort floor (GROUP_EVAL_MIN_COHORT=2,
// bug-ui-scan-2026-07-09 #4 — a single candidate no longer crowns/seals a lead). Scored
// well below `candidate` so the tracked entry stays the deterministic lead.
const rival = (entryId: string) => ({ entryId: `${entryId}-rival`, candidateId: null, label: "Grace Hopper", matchScore: 40 });
const sealedKinds = (entryId: string) => listDecisionRecords({ candidateRef: entryId }).map((r) => r.kind);

test("resolveGovernanceMode: a stored governed mode wins over a recommendation request; other changes honour the request", () => {
  // The core guard — a reset/default client mode must NOT downgrade a governed role.
  assert.equal(resolveGovernanceMode("committee", "recommendation"), "committee");
  assert.equal(resolveGovernanceMode("eligibility_list", "recommendation"), "eligibility_list");
  // Switching BETWEEN governed modes is a real, allowed change.
  assert.equal(resolveGovernanceMode("committee", "eligibility_list"), "eligibility_list");
  // Fresh role, escalation, and the non-sticky recommendation baseline all honour the request.
  assert.equal(resolveGovernanceMode(null, "committee"), "committee");
  assert.equal(resolveGovernanceMode("recommendation", "committee"), "committee");
  assert.equal(resolveGovernanceMode(null, "recommendation"), "recommendation");
  assert.equal(resolveGovernanceMode("recommendation", "recommendation"), "recommendation");
});

test("committee governance persists across a reload/rerun and blocks the AI auto-seal", async () => {
  const roleKey = "role-committee";
  const entryId = "entry-committee";

  // 1. A correct first run in committee mode.
  const first = await runGroupEval({
    roleKey,
    roleTitle: "Faculty Search",
    candidates: [candidate(entryId), rival(entryId)],
    governanceMode: "committee",
  });
  assert.equal(first.governanceMode, "committee");
  assert.equal(first.advisory, true);
  // Governance is persisted WITH the role (read back from the stored eval).
  assert.equal(getGroupEval(roleKey)?.payload.governanceMode, "committee");
  // The AI recorded an ADVISORY input, NOT a sealed lead.
  let kinds = sealedKinds(entryId);
  assert.ok(kinds.includes("group_eval_advisory"), `expected an advisory seal, got [${kinds.join(", ")}]`);
  assert.ok(!kinds.includes("group_eval_lead"), `committee must NOT auto-seal a lead, got [${kinds.join(", ")}]`);

  // 2. The reported bug path: the tab remounts, evalMode resets to the default
  // "recommendation", and the user (or another user) reruns. The PERSISTED governance
  // must win server-side — no silent downgrade, no auto-sealed lead.
  const second = await runGroupEval({
    roleKey,
    roleTitle: "Faculty Search",
    candidates: [candidate(entryId), rival(entryId)],
    governanceMode: "recommendation",
  });
  assert.equal(second.governanceMode, "committee", "a reset client mode must not downgrade a governed role");
  assert.equal(second.advisory, true);
  kinds = sealedKinds(entryId);
  assert.ok(!kinds.includes("group_eval_lead"), `rerun with reset mode must still NOT auto-seal a lead, got [${kinds.join(", ")}]`);
});

test("recommendation mode is unchanged — a fresh role auto-seals the AI lead", async () => {
  const roleKey = "role-reco";
  const entryId = "entry-reco";

  const res = await runGroupEval({
    roleKey,
    roleTitle: "Backend Engineer",
    candidates: [candidate(entryId), rival(entryId)],
    governanceMode: "recommendation",
  });
  assert.equal(res.governanceMode, "recommendation");
  assert.equal(res.advisory, false);
  const kinds = sealedKinds(entryId);
  assert.ok(kinds.includes("group_eval_lead"), `recommendation must auto-seal a lead, got [${kinds.join(", ")}]`);
  assert.ok(!kinds.includes("group_eval_advisory"), `recommendation must not seal an advisory record, got [${kinds.join(", ")}]`);
});
