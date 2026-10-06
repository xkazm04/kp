// Fixtures for the pure half of the goal-1 demo-run instrument. The failure these exist for:
// a reading that prints a number when the run measured nothing — an empty ledger, a cancelled
// run, an empty slate — or that hides which gate a branch is parked at.
//
//   node --test scripts/kpi/__tests__/role-demo-run-reading.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GATE_OF_STAGE,
  STAGE_ORDER,
  STAND_IN_APPROVER,
  branchesByFurthest,
  formatCoverage,
  formatGateCounts,
  formatStandInTally,
  furthestPerBranch,
  goalOneHeadline,
  scorecardRecommendationOf,
  screenRouteOf,
  stagesReached,
  standInDecision,
  stoppedAt,
  summarizeRoleDemoRun,
  tallyStandIn,
} from "../role-demo-run-reading.mjs";

let seq = 0;
const art = (kind, branchRef, status, payload) => ({ kind, branchRef, status, seq: ++seq, payload });

const spec = () => art("role_spec", null, "complete", { lintFindings: [] });
const slate = (...refs) => art("slate", null, "complete", { candidates: refs.map((candidateRef) => ({ candidateRef })) });

test("an empty ledger is not measured", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [] });
  assert.equal(r.measured, false);
  assert.equal(r.headline, "not measured: no stage produced an artifact");
  assert.equal(r.furthest, null);
});

test("a cancelled run gives the reason its role spec recorded", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "cancelled",
    artifacts: [art("role_spec", null, "terminal", { lintFindings: ["job_not_found"] })],
  });
  assert.equal(r.measured, false);
  assert.equal(r.headline, "not measured: run cancelled (job_not_found)");
});

test("a cancelled run with no recorded finding still says it was cancelled", () => {
  const r = summarizeRoleDemoRun({ runStatus: "cancelled", artifacts: [spec()] });
  assert.equal(r.headline, "not measured: run cancelled");
});

test("a slate with no candidates is not measured", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec(), slate()] });
  assert.equal(r.measured, false);
  assert.match(r.headline, /^not measured: no slate formed/);
});

test("branches parked at the rejection gate are named, with the furthest stage", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [spec(), slate("e1", "e2", "e3"), ...["e1", "e2", "e3"].map((e) => art("screen", e, "awaiting_approval"))],
  });
  assert.equal(r.measured, true);
  assert.equal(r.furthest, "screen");
  assert.equal(r.headline, "reached screen; 3 branches parked at gates rejection");
  assert.deepEqual(r.parkedByGate, { rejection: ["e1", "e2", "e3"] });
});

test("branches at different gates are all named, and a resolved gate is not parked", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [
      spec(),
      slate("a", "b", "c"),
      art("screen", "a", "awaiting_approval"),
      art("screen", "b", "awaiting_approval"),
      art("screen", "b", "complete"),
      art("case_assignment", "b", "complete"),
      art("interview", "b", "awaiting_approval"),
      art("screen", "c", "awaiting_approval"),
      art("screen", "c", "terminal"),
    ],
  });
  assert.equal(r.headline, "reached interview; 2 branches parked at gates rejection, interview_invite");
  assert.deepEqual(r.parkedByGate, { rejection: ["a"], interview_invite: ["b"] });
});

test("one parked branch reads in the singular", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec(), slate("a"), art("screen", "a", "awaiting_approval")] });
  assert.equal(r.headline, "reached screen; 1 branch parked at gates rejection");
});

test("a blocked stage is named with what it needs and is never stubbed over", () => {
  const r = summarizeRoleDemoRun({
    runStatus: "running",
    artifacts: [spec(), slate("a"), art("screen", "a", "awaiting_approval")],
    blocked: { stage: "case_assignment", needs: "an LLM key" },
  });
  assert.equal(r.headline, "not measured: case_assignment needs an LLM key");
});

test("an engine failure is not measured and carries its message", () => {
  const r = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec()], failure: "engine threw after 1 pass: boom" });
  assert.equal(r.headline, "not measured: engine threw after 1 pass: boom");
});

// ---- the goal-1 headline: three forms, and a run that could not be read keeps its cause ----

const measured = { measured: true, headline: "reached screen; 20 branches parked at gates rejection" };

test("goal 1 met leads with 'goal 1: met'", () => {
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured), "goal 1: met");
});

test("goal 1 not met names the reason, an open gate being an allowed step", () => {
  const reason = "stopped at the rejection gate: 20 awaiting approval (an allowed step)";
  assert.equal(goalOneHeadline({ verdict: "not met", reason }, measured), `goal 1: not met: ${reason}`);
});

test("an empty ledger's goal-1 verdict is 'not measured', never 'not met'", () => {
  assert.equal(goalOneHeadline({ verdict: "not measured", reason: "no stage produced an artifact" }, measured), "not measured: no stage produced an artifact");
});

test("a run that could not be read keeps its own cause over the goal-1 verdict", () => {
  const unread = summarizeRoleDemoRun({ runStatus: "cancelled", artifacts: [art("role_spec", null, "terminal", { lintFindings: ["job_not_found"] })] });
  assert.equal(goalOneHeadline({ verdict: "not met", reason: "no branch reached a resolved offer gate" }, unread), "not measured: run cancelled (job_not_found)");
});

// ---- the stand-in's policy: one test per row -------------------------------------------

test("rejection gate: a hold is LEFT — the stand-in never decides a hold", () => {
  const d = standInDecision({ gate: "rejection", screenRoute: "hold" });
  assert.equal(d.action, "leave");
  assert.equal(d.reason, "score below floor");
});

test("rejection gate: an advance is approved", () => {
  assert.equal(standInDecision({ gate: "rejection", screenRoute: "advance" }).action, "approve");
});

test("rejection gate: a proposed rejection is approved — approving the proposal is what the engine defines", () => {
  assert.equal(standInDecision({ gate: "rejection", screenRoute: "reject_proposed" }).action, "approve");
});

test("rejection gate: no recorded route is left, never guessed", () => {
  assert.equal(standInDecision({ gate: "rejection", screenRoute: null }).action, "leave");
  assert.equal(standInDecision({ gate: "rejection" }).action, "leave");
});

test("interview invite: approved only after an advance, left after anything else", () => {
  assert.equal(standInDecision({ gate: "interview_invite", screenRoute: "advance" }).action, "approve");
  for (const route of ["hold", "reject_proposed", null]) {
    assert.equal(standInDecision({ gate: "interview_invite", screenRoute: route }).action, "leave", String(route));
  }
});

test("offer gate: an unrated scorecard is declined with the interview-session reason", () => {
  assert.deepEqual(standInDecision({ gate: "offer", scorecardRecommendation: "unrated" }), { action: "decline", reason: "scorecard unrated: no interview session" });
});

test("offer gate: a positive scorecard is approved", () => {
  assert.equal(standInDecision({ gate: "offer", scorecardRecommendation: "advance" }).action, "approve");
});

test("offer gate: a negative value or a missing card is declined, with the actual value", () => {
  assert.deepEqual(standInDecision({ gate: "offer", scorecardRecommendation: "reject" }), { action: "decline", reason: "scorecard recommendation: reject" });
  assert.equal(standInDecision({ gate: "offer", scorecardRecommendation: "hold" }).action, "decline");
  assert.deepEqual(standInDecision({ gate: "offer", scorecardRecommendation: null }), { action: "decline", reason: "no scorecard card recorded" });
  assert.equal(standInDecision({ gate: "offer" }).action, "decline");
});

test("the stand-in never declines at the rejection gate and never approves a hold, whatever the inputs", () => {
  for (const screenRoute of ["advance", "hold", "reject_proposed", null, "weird"]) {
    for (const scorecardRecommendation of ["advance", "unrated", "reject", null]) {
      const d = standInDecision({ gate: "rejection", screenRoute, scorecardRecommendation });
      assert.notEqual(d.action, "decline");
      if (screenRoute === "hold") assert.equal(d.action, "leave");
    }
  }
});

test("the positive value the policy waits for is a value the interview vocabulary has", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const src = readFileSync(path.join(root, "app/_lib/interview-recommendation.ts"), "utf8");
  assert.match(src, /INTERVIEW_RECOMMENDATIONS = \["advance", "hold", "reject"\]/);
});

// ---- reading the policy's inputs off the ledger ------------------------------------------

test("the screen route is read off the branch's own screen rows, a proposed rejection outranking a hold", () => {
  const rows = [
    art("screen", "a", "awaiting_approval", { decisions: [{ entryId: "a", route: "hold" }] }),
    art("screen", "b", "awaiting_approval", { decisions: [{ entryId: "b", route: "advance" }] }),
    art("screen", "b", "complete", { decisions: [{ entryId: "b", route: "advance" }], gate: "rejection", decision: "approved" }),
    art("screen", "c", "awaiting_approval", { decisions: [{ route: "advance" }, { route: "reject_proposed" }, { route: "hold" }] }),
  ];
  assert.equal(screenRouteOf(rows, "a"), "hold");
  assert.equal(screenRouteOf(rows, "b"), "advance");
  assert.equal(screenRouteOf(rows, "c"), "reject_proposed");
  assert.equal(screenRouteOf(rows, "nobody"), null);
});

test("the scorecard recommendation is the branch's own latest complete card, else null", () => {
  const rows = [
    art("scorecard", "a", "complete", { cards: [{ entryId: "a", recommendation: "unrated" }] }),
    art("scorecard", "b", "complete", { cards: [{ entryId: "b", recommendation: "unrated" }] }),
    art("scorecard", "b", "complete", { cards: [{ entryId: "b", recommendation: "advance" }] }),
    art("scorecard", "c", "complete", { cards: [{ entryId: "someone-else", recommendation: "advance" }] }),
    art("scorecard", "d", "awaiting_approval", { cards: [{ entryId: "d", recommendation: "advance" }] }),
  ];
  assert.equal(scorecardRecommendationOf(rows, "a"), "unrated");
  assert.equal(scorecardRecommendationOf(rows, "b"), "advance");
  assert.equal(scorecardRecommendationOf(rows, "c"), null);
  assert.equal(scorecardRecommendationOf(rows, "d"), null);
  assert.equal(scorecardRecommendationOf(rows, "e"), null);
});

// ---- the tally, and the goal-1 headline it feeds ------------------------------------------

const d = (gate, action, reason) => ({ gate, action, reason });
const repeat = (n, x) => Array.from({ length: n }, () => x);

test("the tally counts approved / declined / left per gate, with each reason and its count", () => {
  const tally = tallyStandIn([
    ...repeat(4, d("rejection", "approve", "screen routed advance")),
    ...repeat(16, d("rejection", "leave", "score below floor")),
    ...repeat(4, d("interview_invite", "approve", "screen routed advance")),
    ...repeat(4, d("offer", "decline", "scorecard unrated: no interview session")),
  ]);
  assert.deepEqual(tally.byGate, {
    rejection: { approved: 4, declined: 0, left: 16 },
    interview_invite: { approved: 4, declined: 0, left: 0 },
    offer: { approved: 0, declined: 4, left: 0 },
  });
  assert.deepEqual(tally.reasons, [
    { action: "leave", gate: "rejection", reason: "score below floor", count: 16 },
    { action: "decline", gate: "offer", reason: "scorecard unrated: no interview session", count: 4 },
  ]);
  assert.deepEqual(formatStandInTally(tally), [
    "rejection: approved 4 · declined 0 · left 16",
    "interview_invite: approved 4 · declined 0 · left 0",
    "offer: approved 0 · declined 4 · left 0",
    "left at rejection ×16: score below floor",
    "declined at offer ×4: scorecard unrated: no interview session",
  ]);
});

test("an empty tally still shows every gate at zero", () => {
  assert.deepEqual(tallyStandIn([]).byGate, { rejection: { approved: 0, declined: 0, left: 0 }, interview_invite: { approved: 0, declined: 0, left: 0 }, offer: { approved: 0, declined: 0, left: 0 } });
});

const policy = (decisions) => ({ mode: "policy", tally: tallyStandIn(decisions) });

test("a policy run that approved no offer names what stopped it", () => {
  const standIn = policy([
    ...repeat(4, d("rejection", "approve", "screen routed advance")),
    ...repeat(16, d("rejection", "leave", "score below floor")),
    ...repeat(4, d("interview_invite", "approve", "screen routed advance")),
    ...repeat(4, d("offer", "decline", "scorecard unrated: no interview session")),
  ]);
  const reason = "stopped at the rejection gate: 16 awaiting approval (an allowed step)";
  assert.equal(
    goalOneHeadline({ verdict: "not met", reason, humanStepsOutsideGates: 0 }, measured, standIn),
    "goal 1: not met: 0 offers approved; 4 offers declined (scorecard unrated: no interview session); 16 held for a person at the rejection gate (gates approved by demo stand-in)"
  );
});

test("a policy run reads 'met' only when the ledger says met AND an offer was approved on the policy", () => {
  const approved = policy([d("rejection", "approve", "x"), d("interview_invite", "approve", "x"), d("offer", "approve", "scorecard recommendation: advance")]);
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured, approved), "goal 1: met: 1 offer approved on a recorded basis (gates approved by demo stand-in)");
  // a ledger 'met' with no stand-in offer approval behind it is not taken on trust
  const none = policy([d("rejection", "approve", "x")]);
  assert.match(goalOneHeadline({ verdict: "met", reason: null }, measured, none), /^goal 1: not met: 0 offers approved/);
});

test("a policy run with nothing declined or held falls back to the ledger's own reason", () => {
  assert.equal(
    goalOneHeadline({ verdict: "not met", reason: "no branch reached a resolved offer gate" }, measured, policy([])),
    "goal 1: not met: 0 offers approved; no branch reached a resolved offer gate (gates approved by demo stand-in)"
  );
});

test("a human step outside the gates is still named in a policy run's headline", () => {
  const headline = goalOneHeadline({ verdict: "not met", reason: "2 human steps outside the gates", humanStepsOutsideGates: 2 }, measured, policy([d("offer", "approve", "x")]));
  assert.match(headline, /2 human steps outside the gates/);
});

test("the --approve-all headline is never 'met', whatever the ledger says", () => {
  const all = { mode: "all", tally: tallyStandIn([d("rejection", "approve", "approve-all: no policy"), d("interview_invite", "approve", "approve-all: no policy"), d("offer", "approve", "approve-all: no policy")]) };
  const expected = "goal 1: verdict withheld: the stand-in approved without a policy (--approve-all, mechanics only)";
  for (const verdict of ["met", "not met", "not measured"]) {
    const headline = goalOneHeadline({ verdict, reason: verdict === "met" ? null : "x" }, measured, all);
    assert.equal(headline, expected);
    assert.doesNotMatch(headline, /: met\b/);
  }
});

test("a run that could not be read keeps its cause under either stand-in", () => {
  const unread = summarizeRoleDemoRun({ runStatus: "running", artifacts: [spec()], failure: "engine threw after 2 passes at the slate stage (inferred from the ledger): needs a key" });
  const cause = "not measured: engine threw after 2 passes at the slate stage (inferred from the ledger): needs a key";
  assert.equal(goalOneHeadline({ verdict: "not met", reason: "x" }, unread, policy([])), cause);
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, unread, { mode: "all", tally: tallyStandIn([]) }), cause);
});

test("without a stand-in the headline carries no stand-in wording", () => {
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured), "goal 1: met");
  assert.equal(goalOneHeadline({ verdict: "met", reason: null }, measured, null), "goal 1: met");
  assert.equal(STAND_IN_APPROVER, "demo-stand-in");
});

test("--approve-all reports the stages each branch reached", () => {
  const rows = [spec(), slate("a", "b", "c"), art("screen", "a", "terminal"), art("screen", "b", "complete"), art("case_assignment", "b", "complete"), art("interview", "b", "complete"), art("scorecard", "b", "complete"), art("offer_draft", "b", "complete"), art("screen", "c", "awaiting_approval")];
  assert.deepEqual(furthestPerBranch(rows), [
    { branchRef: "a", furthest: "screen" },
    { branchRef: "b", furthest: "offer_draft" },
    { branchRef: "c", furthest: "screen" },
  ]);
  assert.deepEqual(branchesByFurthest(rows), [
    { kind: "screen", branches: 2 },
    { kind: "offer_draft", branches: 1 },
  ]);
});

test("stages reached count chains per stage in ladder order", () => {
  const rows = [spec(), slate("a", "b"), art("screen", "a", "awaiting_approval"), art("screen", "b", "awaiting_approval"), art("screen", "a", "complete"), art("case_assignment", "a", "complete")];
  assert.deepEqual(stagesReached(rows), [
    { kind: "role_spec", chains: 1 },
    { kind: "slate", chains: 1 },
    { kind: "screen", chains: 2 },
    { kind: "case_assignment", chains: 1 },
  ]);
  assert.deepEqual(stagesReached([]), []);
});

test("where it stopped: a failure, a gate, a finished run, or nothing left", () => {
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {}, failure: "engine threw after 1 pass: boom" }), "engine threw after 1 pass: boom");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: { rejection: ["a", "b"], offer: ["c"] } }), "awaiting approval at rejection (2), offer (1)");
  assert.equal(stoppedAt({ runStatus: "complete", parkedByGate: {} }), "run complete: every branch ended");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {}, capped: true }), "the pass ceiling, with the run still running");
  assert.equal(stoppedAt({ runStatus: "running", parkedByGate: {} }), "nothing left to produce");
});

test("per-gate counts print in the order given, zeros included", () => {
  assert.equal(formatGateCounts({ rejection: 20, interview_invite: 0, offer: 0 }), "rejection 20 · interview_invite 0 · offer 0");
});

test("a coverage row with nothing to divide is n/a, not a percentage", () => {
  assert.equal(formatCoverage({ total: 0, autonomousComplete: 0, coverage: null }), "n/a (0 artifacts)");
  assert.equal(formatCoverage({ total: 4, autonomousComplete: 1, coverage: 0.25 }), "1/4 (25%)");
});

test("the restated ladder and gate map still match the engine's source", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const stages = readFileSync(path.join(root, "app/_lib/role-run-stages.ts"), "utf8");
  const literal = stages.match(/ROLE_RUN_STAGES = \[([\s\S]*?)\] as const/)[1];
  assert.deepEqual([...literal.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]), STAGE_ORDER);
  const gates = readFileSync(path.join(root, "app/_lib/role-run-gates.ts"), "utf8");
  const map = gates.match(/GATE_STAGE[^=]*= \{([\s\S]*?)\}/)[1];
  const fromSource = Object.fromEntries([...map.matchAll(/(\w+):\s*"(\w+)"/g)].map((m) => [m[2], m[1]]));
  assert.deepEqual(fromSource, GATE_OF_STAGE);
});
