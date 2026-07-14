// Locks the pure ElevenLabs agent config diff (extracted from
// scripts/setup-eleven-agent.mjs so `--check` can report drift with no network).
// The diff drives the --check exit code (ok → 0, drift → 1), so a wrong verdict
// here would either green-light a drifted live agent or cry wolf on a clean one.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  diffAgentConfig,
  firstDifferenceIndex,
  extractLiveOverrides,
} from "./eleven-agent-diff.mjs";

const intended = {
  prompt: "You are a warm interviewer. Ask ONE question per turn.",
  asrKeywords: ["React", "PostgreSQL", "Kubernetes"],
  overrides: { prompt: true, first_message: true, language: true },
};

/** A live agent JSON that exactly matches `intended`, in the GET-agent shape. */
function matchingAgent() {
  return {
    conversation_config: {
      agent: { prompt: { prompt: intended.prompt }, first_message: "hi", language: "cs" },
      asr: { keywords: ["React", "PostgreSQL", "Kubernetes"] },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { prompt: { prompt: true }, first_message: true, language: true },
        },
      },
    },
  };
}

test("an exactly-matching live agent reports ok with no drift", () => {
  const report = diffAgentConfig(intended, matchingAgent());
  assert.equal(report.ok, true);
  assert.equal(report.prompt.match, true);
  assert.equal(report.asrKeywords.match, true);
  assert.equal(report.overrides.match, true);
});

test("keyword order does not matter; missing and extra are reported separately", () => {
  const agent = matchingAgent();
  agent.conversation_config.asr.keywords = ["Kubernetes", "React", "Rust"]; // dropped PostgreSQL, added Rust
  const report = diffAgentConfig(intended, agent);
  assert.equal(report.ok, false);
  assert.equal(report.asrKeywords.match, false);
  assert.deepEqual(report.asrKeywords.missing, ["PostgreSQL"]);
  assert.deepEqual(report.asrKeywords.extra, ["Rust"]);
});

test("a drifted prompt is flagged with the first differing char index", () => {
  const agent = matchingAgent();
  agent.conversation_config.agent.prompt.prompt = "You are a warm interviewer. Ask TWO questions per turn.";
  const report = diffAgentConfig(intended, agent);
  assert.equal(report.ok, false);
  assert.equal(report.prompt.match, false);
  assert.equal(report.prompt.firstDiffAt, firstDifferenceIndex(intended.prompt, agent.conversation_config.agent.prompt.prompt));
  assert.ok(report.prompt.firstDiffAt > 0);
});

test("a disabled override flag is caught per-field", () => {
  const agent = matchingAgent();
  agent.platform_settings.overrides.conversation_config_override.agent.prompt.prompt = false;
  const report = diffAgentConfig(intended, agent);
  assert.equal(report.ok, false);
  assert.equal(report.overrides.match, false);
  const promptFlag = report.overrides.flags.find((f) => f.flag === "prompt");
  assert.equal(promptFlag?.live, false);
  assert.equal(promptFlag?.intended, true);
  assert.equal(promptFlag?.match, false);
  // The other two flags still match.
  assert.equal(report.overrides.flags.find((f) => f.flag === "language")?.match, true);
});

test("a malformed/empty agent body degrades to drift, never a crash", () => {
  const report = diffAgentConfig(intended, {});
  assert.equal(report.ok, false);
  assert.equal(report.prompt.live, "");
  assert.deepEqual(report.asrKeywords.missing, intended.asrKeywords);
  assert.deepEqual(report.asrKeywords.extra, []);
  // Absent overrides read as disabled.
  assert.deepEqual(extractLiveOverrides({}), { prompt: false, first_message: false, language: false });
  assert.equal(report.overrides.flags.every((f) => f.live === false), true);
});

test("firstDifferenceIndex: identical → -1, prefix → length of shorter", () => {
  assert.equal(firstDifferenceIndex("abc", "abc"), -1);
  assert.equal(firstDifferenceIndex("abc", "abcd"), 3);
  assert.equal(firstDifferenceIndex("abX", "abY"), 2);
});
