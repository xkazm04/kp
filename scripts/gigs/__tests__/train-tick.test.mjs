// Fixtures for scripts/gigs/train-tick.mjs. Only the PURE helpers are exercised -
// arg parsing, the stage classifier, the in-flight counter, the approval-line
// parser, and DONE - with injected inputs. No test touches the DB, the network, a
// child process, or the filesystem: the module lazy-imports the kp store inside
// runPass, so importing it here (under plain `node --test`, no alias loader) loads
// nothing but these functions.
//
// Run: node --test scripts/gigs/__tests__/train-tick.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPROVE_NOTE,
  ARENA,
  DEFAULTS,
  EXIT,
  OSS_WORKSPACE_NAME,
  classifyStage,
  countInFlight,
  formatTally,
  isDone,
  ossHireApprovalIds,
  parseApprovalLine,
  parseArgs,
  tallyStages,
} from "../train-tick.mjs";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

test("the arena is fixed to oss_bounty and the workspace/note are the oss ones", () => {
  assert.equal(ARENA, "oss_bounty");
  assert.equal(OSS_WORKSPACE_NAME, "OSS bounties");
  assert.equal(APPROVE_NOTE, "oss training");
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test("parseArgs: defaults", () => {
  const a = parseArgs([]);
  assert.equal(a.set, DEFAULTS.set);
  assert.equal(a.state, DEFAULTS.state);
  assert.equal(a.maxInflight, 2);
  assert.equal(a.niche, DEFAULTS.niche);
  assert.equal(a.once, false);
  assert.equal(a.help, false);
  assert.equal(a.personasDir, null);
});

test("parseArgs: values and booleans", () => {
  const a = parseArgs([
    "--set", "/tmp/s.json",
    "--state", "/tmp/state.json",
    "--max-inflight", "3",
    "--niche", "docs and TS",
    "--personas-dir", "/opt/personas",
    "--once",
  ]);
  assert.equal(a.set, "/tmp/s.json");
  assert.equal(a.state, "/tmp/state.json");
  assert.equal(a.maxInflight, 3);
  assert.equal(a.niche, "docs and TS");
  assert.equal(a.personasDir, "/opt/personas");
  assert.equal(a.once, true);
});

test("parseArgs: --help", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("parseArgs: a missing value throws", () => {
  assert.throws(() => parseArgs(["--set"]), /needs a value/);
  assert.throws(() => parseArgs(["--niche", "--set"]), /needs a value/);
});

test("parseArgs: a bad --max-inflight and an unknown flag throw", () => {
  assert.throws(() => parseArgs(["--max-inflight", "nope"]), /positive integer/);
  assert.throws(() => parseArgs(["--max-inflight", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--max-inflight", "2.5"]), /positive integer/);
  assert.throws(() => parseArgs(["--max-inflight", "-1"]), /positive integer/);
  assert.throws(() => parseArgs(["--frobnicate"]), /unknown argument/);
});

// ---------------------------------------------------------------------------
// classifyStage
// ---------------------------------------------------------------------------

test("classifyStage: a missing gig is `missing`", () => {
  assert.equal(classifyStage(null, null), "missing");
  assert.equal(classifyStage(undefined, null), "missing");
});

test("classifyStage: gig status maps straight through", () => {
  assert.equal(classifyStage({ status: "new" }, null), "new");
  assert.equal(classifyStage({ status: "qualified" }, null), "qualified");
  assert.equal(classifyStage({ status: "drafted" }, { status: "drafted" }), "drafted");
});

test("classifyStage: dispatched vs running is decided by the latest attempt", () => {
  assert.equal(classifyStage({ status: "dispatched" }, { status: "dispatched" }), "dispatched");
  assert.equal(classifyStage({ status: "dispatched" }, { status: "running" }), "running");
  // a dispatched gig with no attempt row yet is still `dispatched`
  assert.equal(classifyStage({ status: "dispatched" }, null), "dispatched");
});

test("classifyStage: a qualified gig whose last attempt FAILED is benched as `failed`", () => {
  assert.equal(classifyStage({ status: "qualified" }, { status: "failed" }), "failed");
  // but a fresh qualified gig, or one the operator discarded/revised, stays dispatchable
  assert.equal(classifyStage({ status: "qualified" }, null), "qualified");
  assert.equal(classifyStage({ status: "qualified" }, { status: "discarded" }), "qualified");
});

test("classifyStage: everything else (suspect, in_review, sent, ...) is `other`", () => {
  for (const status of ["suspect", "in_review", "sent", "accepted", "declined", "withdrawn", "expired"]) {
    assert.equal(classifyStage({ status }, null), "other", status);
  }
});

// ---------------------------------------------------------------------------
// countInFlight
// ---------------------------------------------------------------------------

test("countInFlight: counts dispatched + running gigs only", () => {
  const stages = ["new", "qualified", "dispatched", "running", "drafted", "failed", "dispatched"];
  assert.equal(countInFlight(stages), 3);
  assert.equal(countInFlight(["drafted", "failed", "new"]), 0);
  assert.equal(countInFlight([]), 0);
});

test("countInFlight: a building hire counts as one in-flight run", () => {
  assert.equal(countInFlight(["dispatched"], { hireBuilding: true }), 2);
  assert.equal(countInFlight([], { hireBuilding: true }), 1);
  assert.equal(countInFlight(["dispatched"], { hireBuilding: false }), 1);
});

// ---------------------------------------------------------------------------
// isDone / tally
// ---------------------------------------------------------------------------

test("isDone: true only when every gig is drafted or failed", () => {
  assert.equal(isDone({ a: "drafted", b: "failed", c: "drafted" }), true);
  assert.equal(isDone({ a: "drafted", b: "qualified" }), false);
  assert.equal(isDone({ a: "drafted", b: "other" }), false);
  // an empty set is not "done"
  assert.equal(isDone({}), false);
});

test("tallyStages / formatTally: counts per stage in report order", () => {
  const stageById = { a: "new", b: "new", c: "qualified", d: "drafted", e: "failed" };
  assert.deepEqual(tallyStages(stageById), { new: 2, qualified: 1, drafted: 1, failed: 1 });
  assert.equal(formatTally(stageById), "new=2 qualified=1 drafted=1 failed=1");
  assert.equal(formatTally({}), "(empty set)");
});

// ---------------------------------------------------------------------------
// approval-line parsing (the OSS-only hire-approval gate)
// ---------------------------------------------------------------------------

test("parseApprovalLine: pulls id, action and the quoted workspace", () => {
  const line =
    "  appr_abc123  kp_hire_request  Gig specialist - OSS x -> workspace 'OSS bounties', $5  (by kp, expires 2026-09-27T00:00:00Z)";
  assert.deepEqual(parseApprovalLine(line), {
    apprId: "appr_abc123",
    action: "kp_hire_request",
    workspace: "OSS bounties",
  });
});

test("parseApprovalLine: a line with no workspace still parses (workspace null)", () => {
  const line = "  appr_xyz  some_action  a rationale with no workspace  (by kp, expires t)";
  assert.deepEqual(parseApprovalLine(line), { apprId: "appr_xyz", action: "some_action", workspace: null });
});

test("parseApprovalLine: non-approval lines return null", () => {
  assert.equal(parseApprovalLine("Pending approvals: 2"), null);
  assert.equal(parseApprovalLine("Pending pairings: 0"), null);
  assert.equal(parseApprovalLine(""), null);
  assert.equal(parseApprovalLine("  nonce123  App from origin  scopes []"), null);
});

test("ossHireApprovalIds: approves ONLY 'OSS bounties' kp_hire_request lines, never freelance's", () => {
  const out = [
    "Pending approvals: 3",
    "  appr_oss1  kp_hire_request  Gig specialist A -> workspace 'OSS bounties', $5  (by kp, expires t)",
    "  appr_free1  kp_hire_request  Gig specialist B -> workspace 'Freelance', $8  (by kp, expires t)",
    "  appr_oss2  kp_hire_request  Gig specialist C -> workspace 'OSS bounties', $6  (by kp, expires t)",
    "  appr_other  build_oneshot  something -> workspace 'OSS bounties'  (by kp, expires t)",
    "Pending pairings: 0",
  ].join("\n");
  assert.deepEqual(ossHireApprovalIds(out), ["appr_oss1", "appr_oss2"]);
  // the freelance hire is never in the result
  assert.ok(!ossHireApprovalIds(out).includes("appr_free1"));
  // a non-hire action for the OSS workspace is not approved either
  assert.ok(!ossHireApprovalIds(out).includes("appr_other"));
});

test("ossHireApprovalIds: handles CRLF and an empty list", () => {
  const crlf = "Pending approvals: 1\r\n  appr_oss1  kp_hire_request  X -> workspace 'OSS bounties', $5  (by kp)\r\n";
  assert.deepEqual(ossHireApprovalIds(crlf), ["appr_oss1"]);
  assert.deepEqual(ossHireApprovalIds("Pending approvals: 0"), []);
  assert.deepEqual(ossHireApprovalIds(""), []);
});

// ---------------------------------------------------------------------------
// the exit-code contract
// ---------------------------------------------------------------------------

test("EXIT codes are the documented ones", () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.USAGE, 2);
});
