import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCommand, isMutating, parseCommand, resolveRejectTargets } from "./pipeline-command.ts";

test("parses reject-below with and without a job scope, clamps the threshold", () => {
  assert.deepEqual(parseCommand("reject everyone below 60%"), {
    kind: "reject_below",
    threshold: 60,
    jobQuery: null,
  });
  assert.deepEqual(parseCommand("reject all candidates below 45 on backend engineer"), {
    kind: "reject_below",
    threshold: 45,
    jobQuery: "backend engineer",
  });
  // threshold clamps into 1..100
  assert.equal((parseCommand("reject below 0%") as { threshold: number }).threshold, 1);
  assert.equal((parseCommand("reject below 250%") as { threshold: number }).threshold, 100);
});

test("parses advance-top and clamps the count", () => {
  assert.deepEqual(parseCommand("advance the top 3"), { kind: "advance_top", count: 3 });
  assert.deepEqual(parseCommand("advance top 5 candidates"), { kind: "advance_top", count: 5 });
  assert.equal((parseCommand("advance top 999") as { count: number }).count, 50); // MAX_ADVANCE
});

test("parses run-policy phrasings", () => {
  assert.equal(parseCommand("run the policy pass").kind, "run_policy");
  assert.equal(parseCommand("run automation").kind, "run_policy");
});

test("help and unknown", () => {
  assert.equal(parseCommand("help").kind, "help");
  assert.equal(parseCommand("?").kind, "help");
  assert.deepEqual(parseCommand("make me a sandwich"), { kind: "unknown", text: "make me a sandwich" });
  assert.equal(parseCommand("").kind, "unknown");
});

test("isMutating flags the action intents only", () => {
  assert.equal(isMutating(parseCommand("reject below 50%")), true);
  assert.equal(isMutating(parseCommand("advance top 2")), true);
  assert.equal(isMutating(parseCommand("run policy")), true);
  assert.equal(isMutating(parseCommand("help")), false);
  assert.equal(isMutating(parseCommand("xyz")), false);
});

test("describeCommand reads as an action sentence", () => {
  // "and notify" is asserted on purpose: the reject command now queues a
  // candidate comm, so the preview copy must promise notification (UAT M3).
  assert.match(describeCommand(parseCommand("reject below 60%")), /Reject and notify active candidates scoring below 60%/);
  assert.match(describeCommand(parseCommand("advance top 1")), /Advance the top 1 active candidate\b/);
});

// bug-ui pipeline #3 — resolveRejectTargets binds a reject_below confirm to the
// previewed cohort. Non-vacuity: resolveRejectTargets did NOT exist before the
// fix — against pre-fix pipeline-command.ts the import above is a named-export
// miss and the whole file errors out (RED). Beyond existence, the cases below
// discriminate the actual contract, so a stub `() => ({ act: [], droppedOut: [] })`
// or a naive `act = stillMatching` (the pre-fix route behavior — act on whoever
// matches NOW) fails them.
test("acts only on ids that were BOTH previewed AND still match (the TOCTOU fix)", () => {
  // Preview showed a,b,c. By confirm time the live matching set is b,c,d:
  //   - `a` advanced out of the below-threshold set → dropped out, must NOT be rejected.
  //   - `d` newly slipped below the line but was NEVER shown → must NOT be rejected.
  //   - `b`,`c` were shown and still match → the only ones acted on.
  const { act, droppedOut } = resolveRejectTargets(["a", "b", "c"], ["b", "c", "d"]);
  assert.deepEqual(act, ["b", "c"]); // never "d" — the unseen candidate the pre-fix code would email
  assert.deepEqual(droppedOut, ["a"]);
});

test("a candidate newly matching but never previewed is NEVER acted on", () => {
  // The core harm: confirm must be a subset of what was shown. Empty preview ⇒
  // nothing rejected even though two candidates now match.
  const { act, droppedOut } = resolveRejectTargets([], ["x", "y"]);
  assert.deepEqual(act, []);
  assert.deepEqual(droppedOut, []);
});

test("act preserves previewed order and is deduplicated", () => {
  const { act, droppedOut } = resolveRejectTargets(["c", "a", "a", "b"], ["a", "b", "c"]);
  assert.deepEqual(act, ["c", "a", "b"]); // previewed order, single `a`
  assert.deepEqual(droppedOut, []);
});

test("every previewed id that no longer matches is reported as dropped out", () => {
  const { act, droppedOut } = resolveRejectTargets(["a", "b"], []);
  assert.deepEqual(act, []);
  assert.deepEqual(droppedOut, ["a", "b"]);
});
