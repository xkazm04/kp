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
