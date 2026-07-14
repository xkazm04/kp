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
  firstMessage: "Dobrý den! / Hello!",
  language: "cs",
  llm: "gemini-2.5-flash",
  temperature: 0.3,
  maxDurationSeconds: 2400,
  ttsModel: "eleven_flash_v2_5",
  textOnly: false,
};

/** A live agent JSON that exactly matches `intended`, in the GET-agent shape. */
function matchingAgent() {
  return {
    conversation_config: {
      agent: {
        prompt: { prompt: intended.prompt, llm: "gemini-2.5-flash", temperature: 0.3 },
        first_message: "Dobrý den! / Hello!",
        language: "cs",
      },
      tts: { model_id: "eleven_flash_v2_5", voice_id: "voice-abc" },
      asr: { keywords: ["React", "PostgreSQL", "Kubernetes"] },
      conversation: { text_only: false, max_duration_seconds: 2400 },
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
  assert.equal(report.scalars.match, true);
  // Every scalar field the deploy body sends is present and matched.
  assert.deepEqual(
    report.scalars.flags.map((s) => s.key).sort(),
    ["firstMessage", "language", "llm", "maxDurationSeconds", "temperature", "textOnly", "ttsModel"],
  );
  assert.equal(report.scalars.flags.every((s) => s.match), true);
});

test("each scalar field drifts independently and flips ok to false", () => {
  // A live value that differs from `intended` for every scalar field.
  const drifted: Record<string, (a: ReturnType<typeof matchingAgent>) => void> = {
    firstMessage: (a) => { a.conversation_config.agent.first_message = "Hi there!"; },
    language: (a) => { a.conversation_config.agent.language = "en"; },
    llm: (a) => { a.conversation_config.agent.prompt.llm = "gpt-4o"; },
    temperature: (a) => { a.conversation_config.agent.prompt.temperature = 0.9; },
    maxDurationSeconds: (a) => { a.conversation_config.conversation.max_duration_seconds = 600; },
    ttsModel: (a) => { a.conversation_config.tts.model_id = "eleven_turbo_v2"; },
    textOnly: (a) => { a.conversation_config.conversation.text_only = true; },
  };
  for (const [key, mutate] of Object.entries(drifted)) {
    const agent = matchingAgent();
    mutate(agent);
    const report = diffAgentConfig(intended, agent);
    assert.equal(report.ok, false, `${key} drift should flip ok`);
    assert.equal(report.scalars.match, false, `${key} drift should flip scalars.match`);
    const flag = report.scalars.flags.find((s) => s.key === key);
    assert.equal(flag?.match, false, `${key} should be the drifted field`);
    // Only the mutated field drifts; the rest still match.
    assert.equal(report.scalars.flags.filter((s) => !s.match).length, 1, `only ${key} should drift`);
  }
});

test("a scalar field absent from the live body degrades to drift, never a crash", () => {
  const agent = matchingAgent();
  // @ts-expect-error — deliberately drop a whole branch to test defensive reads.
  delete agent.conversation_config.conversation;
  const report = diffAgentConfig(intended, agent);
  assert.equal(report.ok, false);
  // Both fields under conversation read as absent (undefined) → drift.
  const maxDur = report.scalars.flags.find((s) => s.key === "maxDurationSeconds");
  const textOnly = report.scalars.flags.find((s) => s.key === "textOnly");
  assert.equal(maxDur?.live, undefined);
  assert.equal(maxDur?.match, false);
  assert.equal(textOnly?.live, undefined);
  assert.equal(textOnly?.match, false);
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
  // Every scalar field reads as absent (undefined) → all drift.
  assert.equal(report.scalars.match, false);
  assert.equal(report.scalars.flags.every((s) => s.live === undefined && !s.match), true);
});

test("firstDifferenceIndex: identical → -1, prefix → length of shorter", () => {
  assert.equal(firstDifferenceIndex("abc", "abc"), -1);
  assert.equal(firstDifferenceIndex("abc", "abcd"), 3);
  assert.equal(firstDifferenceIndex("abX", "abY"), 2);
});
