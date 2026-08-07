// Tenant scope (Direction 1e) — the explicit-workspace seal override for NON-ENTRY
// refs. A policy seal (e.g. apply-threshold's "policy:screening:<ws>") matches no
// pipeline_entries row, so the store's entry-derived resolution would silently fall
// back to the DEFAULT chain even when the caller holds the authenticated workspace.
// sealDecisionSafe(input, workspaceOverride) lets such callers land the record on
// THEIR chain. These behavioral tests pin that against an ISOLATED throwaway DB
// (unit-db.ts stays the first project import).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { sealDecisionSafe, listDecisionRecords, verifyDecisionChain } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

function policySeal(ws: string) {
  return sealDecisionSafe(
    {
      kind: "screening_threshold_adjusted",
      actor: "human:operator",
      policyVersion: "calibration-reco/maxMatch:50->45",
      candidateRef: `policy:screening:${ws}`,
      rationale: `Screening floor adjusted for ${ws}.`,
      reasonCode: "calibrationThreshold",
      inputs: { previousThreshold: 50, suggestedThreshold: 45 },
    },
    ws
  );
}

test("a policy seal with an explicit workspace override lands on the caller's chain, not the default", () => {
  const rec = policySeal("team-a");
  assert.ok(rec, "the seal succeeded");

  // Present in team-a's list + verify; absent from the default team's.
  const teamA = listDecisionRecords({ workspaceId: "team-a" });
  assert.equal(teamA.length, 1);
  assert.equal(teamA[0].kind, "screening_threshold_adjusted");
  assert.equal(teamA[0].candidateRef, "policy:screening:team-a");

  assert.equal(
    listDecisionRecords({ workspaceId: "workspace" }).length,
    0,
    "the default team's chain never receives another team's policy seal"
  );
  assert.ok(verifyDecisionChain("team-a").ok);
});

test("two teams' policy seals build independent chains — neither sees the other's", () => {
  policySeal("team-b");
  policySeal("team-c");
  policySeal("team-b");

  assert.equal(listDecisionRecords({ workspaceId: "team-b" }).length, 2, "team-b has both of its seals");
  assert.equal(listDecisionRecords({ workspaceId: "team-c" }).length, 1, "team-c has only its own");
  assert.ok(verifyDecisionChain("team-b").ok);
  assert.ok(verifyDecisionChain("team-c").ok);
});
