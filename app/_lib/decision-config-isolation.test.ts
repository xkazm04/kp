import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getDecisionConfig, setDecisionConfig, type ScreeningRule } from "./decision-config-store.ts";

after(() => cleanupUnitDb());

const read = (ws: string) => getDecisionConfig<ScreeningRule>("screening", ws).rejectBottomPercent;

// Behavioral tenancy for the dual-tier policy (P2): the org default cascades to every team
// until that team sets its own override; a team's override never touches another team.

test("the org default cascades to every team until a team overrides it", () => {
  // The org sets the company screening baseline (scope 'org' → workspace_id NULL).
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 40 }, "ws-a", "org");
  assert.equal(read("ws-a"), 20, "team A inherits the org default");
  assert.equal(read("ws-b"), 20, "team B inherits the same org default");

  // Team A overrides just for itself (scope 'team').
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 55, maxMatchToReject: 40 }, "ws-a", "team");
  assert.equal(read("ws-a"), 55, "team A now sees its own override (cascade: team wins)");
  assert.equal(read("ws-b"), 20, "team B still inherits the org default — untouched by A's override");
});

test("a team override doesn't create or move the org default", () => {
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 33, maxMatchToReject: 40 }, "ws-c", "team");
  // ws-c sees its override; a brand-new team (ws-d) with no override falls through to the
  // org default set above (20), never to ws-c's private value.
  assert.equal(read("ws-c"), 33, "team C sees its override");
  assert.equal(read("ws-d"), 20, "a team with no override reads the org default, not another team's");
});

// family-floors preservation (family-floors follow-up): most screening writers (the
// rules modal) predate familyFloors and omit the key on a whole-row save — omission
// must PRESERVE the tier's stored overrides, never silently clear them. An explicit
// empty map still clears, so clearing stays expressible.
test("a same-tier write that omits familyFloors preserves them; an explicit {} clears", () => {
  const ws = "ws-floors";
  setDecisionConfig(
    "screening",
    { autoRejectEnabled: true, rejectBottomPercent: 20, maxMatchToReject: 40, familyFloors: { legal_compliance: 55 } },
    ws,
    "team"
  );
  // A modal-style save without the key: floors survive.
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 45 }, ws, "team");
  const kept = getDecisionConfig<ScreeningRule>("screening", ws);
  assert.equal(kept.rejectBottomPercent, 25, "the write itself lands");
  assert.deepEqual(kept.familyFloors, { legal_compliance: 55 }, "omission preserves the stored overrides");

  // The OTHER tier is untouched by preservation (org row has no floors to inherit).
  setDecisionConfig("screening", { autoRejectEnabled: true, rejectBottomPercent: 10, maxMatchToReject: 30 }, ws, "org");
  const orgRowEffective = getDecisionConfig<ScreeningRule>("screening", "ws-other-team");
  assert.equal(orgRowEffective.familyFloors, undefined, "org tier gained no floors from the team tier");

  // Explicit empty map clears.
  setDecisionConfig(
    "screening",
    { autoRejectEnabled: true, rejectBottomPercent: 25, maxMatchToReject: 45, familyFloors: {} },
    ws,
    "team"
  );
  const cleared = getDecisionConfig<ScreeningRule>("screening", ws);
  assert.deepEqual(cleared.familyFloors ?? {}, {}, "an explicit empty map clears the overrides");
});
