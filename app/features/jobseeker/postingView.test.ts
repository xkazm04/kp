// The detail page's pure shaping. `diveOutcome` is the branch the deep-dive button
// takes, and it is pinned here because getting it wrong is invisible: the bug it
// replaced answered a red "the deep-dive could not run" to a KEYLESS install (an honest
// answer, not a failure) and a silent no-op to a template whose verdict was missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diveOutcome, reasoningView } from "./postingView.ts";

test("diveOutcome: the door's three honest answers, and only a broken one is `failed`", () => {
  assert.equal(diveOutcome({ source: "llm", fallbackReason: null }), "llm");
  assert.equal(diveOutcome({ source: "deterministic", fallbackReason: "no_provider" }), "no_provider");
  assert.equal(diveOutcome({ source: "deterministic", fallbackReason: "template" }), "template");
  // A deterministic answer with no reason stated is still a template, never an error:
  // the page must degrade to the honest note, not to red.
  assert.equal(diveOutcome({ source: "deterministic" }), "template");
});

test("diveOutcome: an unreadable answer is `failed`, which is the ONLY red state", () => {
  assert.equal(diveOutcome(null), "failed");
  assert.equal(diveOutcome(undefined), "failed");
  assert.equal(diveOutcome({}), "failed");
  assert.equal(diveOutcome({ source: "POSTING_NOT_FOUND" }), "failed", "a refusal body is not a rationale");
});

test("reasoningView: a rationale without a verdict is nothing to show", () => {
  assert.equal(reasoningView(null), null);
  assert.equal(reasoningView({}), null, "an empty template renders the note alone, not an empty panel");
  assert.equal(reasoningView({ verdict: "   " }), null);
  assert.deepEqual(reasoningView({ verdict: "Worth applying.", strengths: ["TypeScript", 3], gaps: [], interviewProbes: ["Why us?"] }), {
    verdict: "Worth applying.",
    strengths: ["TypeScript"],
    gaps: [],
    probes: ["Why us?"],
  });
});
