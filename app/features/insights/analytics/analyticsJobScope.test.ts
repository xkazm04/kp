// The role axis's pure half: the ?job= parse every reader shares, the fetch URL the
// tab builds from it, and the withheld vocabulary the store emits and the header
// renders (challenge r04 analytics-dashboard/B).
//
// Runner: `npm run test:unit` (node --test, process-isolated, type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_PARAM_MAX, JOB_SCOPE_FIGURE_KEY, analyticsFetchUrl, parseJobParam, withheldByReason, type JobScope } from "./analyticsJobScope.ts";

test("parseJobParam: blank, absent, over-long and control characters are workspace-wide", () => {
  assert.equal(parseJobParam(null), null);
  assert.equal(parseJobParam(undefined), null);
  assert.equal(parseJobParam(""), null);
  assert.equal(parseJobParam("   "), null);
  assert.equal(parseJobParam("x".repeat(JOB_PARAM_MAX + 1)), null);
  assert.equal(parseJobParam("job\u0000a"), null);
  assert.equal(parseJobParam("  job-a  "), "job-a", "trimmed, like every other id param");
  assert.equal(parseJobParam("x".repeat(JOB_PARAM_MAX))?.length, JOB_PARAM_MAX);
});

test("analyticsFetchUrl carries the role beside the window, and neither when absent", () => {
  assert.equal(analyticsFetchUrl(null, null), "/api/analytics");
  assert.equal(analyticsFetchUrl(30, null), "/api/analytics?days=30");
  assert.equal(analyticsFetchUrl(null, "job-a"), "/api/analytics?job=job-a");
  assert.equal(analyticsFetchUrl(90, "job a&b"), "/api/analytics?days=90&job=job+a%26b");
  assert.equal(analyticsFetchUrl(30, "  "), "/api/analytics?days=30", "a blank role is no role");
});

// The exact list the store emits is pinned in app/_lib/db/analytics-job-cohort.test.ts;
// this is the same list, as the client receives it.
const WITHHELD: JobScope["withheld"] = [
  { figure: "bySource", reason: "workspaceOnly" },
  { figure: "channelDecisionTime", reason: "workspaceOnly" },
  { figure: "channelSpend", reason: "workspaceSpend" },
  { figure: "costPerHire", reason: "workspaceSpend" },
  { figure: "computeCostPerHire", reason: "accountLedger" },
  { figure: "koDeclined", reason: "noEntry" },
];

test("every withheld figure has its own catalog line", () => {
  const keys = WITHHELD.map((w) => JOB_SCOPE_FIGURE_KEY[w.figure]);
  assert.equal(new Set(keys).size, WITHHELD.length);
});

test("withheldByReason states a shared reason once and is empty for a workspace view", () => {
  assert.deepEqual(withheldByReason(null), []);
  const groups = withheldByReason({ jobId: "a", jobTitle: "A", withheld: WITHHELD });
  assert.deepEqual(
    groups.map((g) => [g.reason, g.figures]),
    [
      ["workspaceOnly", ["bySource", "channelDecisionTime"]],
      ["workspaceSpend", ["channelSpend", "costPerHire"]],
      ["accountLedger", ["computeCostPerHire"]],
      ["noEntry", ["koDeclined"]],
    ]
  );
});
