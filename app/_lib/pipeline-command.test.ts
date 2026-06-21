import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCommand, isMutating, parseCommand } from "./pipeline-command.ts";

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
