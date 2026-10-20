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
  clientToolDrift,
  diffAgentConfig,
  diffClientTools,
  DIRECTOR_TOOL_RESPONSE_TIMEOUT_SECS,
  extractLiveToolIds,
  firstDifferenceIndex,
  extractLiveOverrides,
  formatDriftReport,
  toElevenClientTool,
} from "./eleven-agent-diff.mjs";
import { DIRECTOR_TOOL_DEFS } from "./director-tools.mjs";

const intended = {
  prompt: "You are a warm interviewer. Ask ONE question per turn.",
  asrKeywords: ["React", "PostgreSQL", "Kubernetes"],
  overrides: { prompt: true, first_message: true, language: true, asr_keywords: true },
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
          // The per-JOB keyword override lives on its OWN branch of the override
          // object, not under `agent` — an unlocked-elsewhere flag is exactly the
          // kind of half-done unlock --check exists to catch.
          asr: { keywords: true },
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
  // The other flags still match.
  assert.equal(report.overrides.flags.find((f) => f.flag === "language")?.match, true);
  assert.equal(report.overrides.flags.find((f) => f.flag === "asr_keywords")?.match, true);
});

test("an agent that never unlocked asr.keywords is drift, not a silent per-session no-op", () => {
  // The failure this catches: the platform IGNORES an override the agent has not
  // enabled, so the call runs on the account-wide keyword list and looks entirely
  // healthy. --check is the only thing that would say otherwise.
  const agent = matchingAgent();
  delete (agent.platform_settings.overrides.conversation_config_override as { asr?: unknown }).asr;
  const report = diffAgentConfig(intended, agent);
  assert.equal(report.ok, false);
  const asrFlag = report.overrides.flags.find((f) => f.flag === "asr_keywords");
  assert.equal(asrFlag?.live, false);
  assert.equal(asrFlag?.intended, true);
  assert.equal(asrFlag?.match, false);
});

test("a malformed/empty agent body degrades to drift, never a crash", () => {
  const report = diffAgentConfig(intended, {});
  assert.equal(report.ok, false);
  assert.equal(report.prompt.live, "");
  assert.deepEqual(report.asrKeywords.missing, intended.asrKeywords);
  assert.deepEqual(report.asrKeywords.extra, []);
  // Absent overrides read as disabled.
  assert.deepEqual(extractLiveOverrides({}), {
    prompt: false,
    first_message: false,
    language: false,
    asr_keywords: false,
  });
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

// ---- the director's client tools (spark ai-interview-parity) --------------------------
// ElevenLabs takes tools as WORKSPACE resources referenced by
// conversation_config.agent.prompt.tool_ids (inline prompt.tools was removed in
// July 2025), so --check follows the ids to each tool_config and diffs it here.

const CLIENT_TOOLS = DIRECTOR_TOOL_DEFS.map(toElevenClientTool);

test("each director tool becomes a blocking client tool whose every property has a description", () => {
  assert.deepEqual(CLIENT_TOOLS.map((t) => t.name), DIRECTOR_TOOL_DEFS.map((d) => d.name));
  for (const t of CLIENT_TOOLS) {
    assert.equal(t.type, "client");
    assert.equal(t.expects_response, true, `${t.name}: the model waits for the director's answer`);
    assert.equal(t.response_timeout_secs, DIRECTOR_TOOL_RESPONSE_TIMEOUT_SECS);
    assert.ok(t.response_timeout_secs >= 1 && t.response_timeout_secs <= 120, "API bound 1..120");
    assert.equal("additionalProperties" in t.parameters, false, "the ElevenLabs schema has no additionalProperties");
    for (const [key, p] of Object.entries(t.parameters.properties)) {
      assert.ok(p.description.trim().length > 0, `${t.name}.${key} needs a description (the API requires one of description/dynamic_variable/...)`);
    }
  }
  const guardrail = CLIENT_TOOLS.find((t) => t.name === "report_guardrail");
  assert.deepEqual(guardrail?.parameters.properties.kind.enum, ["score_request", "instruction_override", "prompt_disclosure", "off_topic"]);
});

test("every property carries the CONTRACT's own description whenever the contract has one", () => {
  // The model reads the same words on both providers: OpenAI mints the contract's
  // schema verbatim, so the ElevenLabs config must not substitute its own wording.
  DIRECTOR_TOOL_DEFS.forEach((def, i) => {
    const props = def.parameters.properties as Record<string, { description?: string }>;
    for (const [key, p] of Object.entries(props)) {
      if (typeof p.description === "string" && p.description.trim()) {
        assert.equal(CLIENT_TOOLS[i].parameters.properties[key].description, p.description, `${def.name}.${key}`);
      }
    }
  });
});

test("an enum property with NO contract description falls back to a generated \"One of:\" line", () => {
  const synthetic = toElevenClientTool({
    name: "synthetic_tool",
    description: "A tool whose enum property has no description.",
    parameters: {
      properties: { mode: { type: "string", enum: ["a", "b"] }, note: { type: "string" } },
      required: ["mode"],
    },
  });
  assert.equal(synthetic.parameters.properties.mode.description, "One of: a, b.");
  assert.deepEqual(synthetic.parameters.properties.mode.enum, ["a", "b"]);
  assert.equal(synthetic.parameters.properties.note.description, "note", "a plain property falls back to its key");
  assert.equal("enum" in synthetic.parameters.properties.note, false);
});

test("a live tool with defaulted extras and reordered `required` is NOT drift", () => {
  const base = CLIENT_TOOLS[1];
  const live = {
    ...base,
    execution_mode: "immediate",
    pre_tool_speech: "auto",
    parameters: { ...base.parameters, required: [...base.parameters.required].reverse() },
  };
  assert.deepEqual(clientToolDrift(base, live), []);
  assert.deepEqual(clientToolDrift(base, { ...base, expects_response: false }), ["expects_response"]);
});

test("diffClientTools reports missing, extra and drifted tools by name", () => {
  const live = [
    ...CLIENT_TOOLS.slice(1), // begin_topic missing
    { ...CLIENT_TOOLS[2], description: "stale wording" }, // same name, later entry wins -> drift
    { type: "client", name: "legacy_tool", description: "x", parameters: {} },
  ];
  const d = diffClientTools(CLIENT_TOOLS, live);
  assert.equal(d.match, false);
  assert.deepEqual(d.missing, ["begin_topic"]);
  assert.deepEqual(d.extra, ["legacy_tool"]);
  assert.deepEqual(d.drifted, [{ name: CLIENT_TOOLS[2].name, fields: ["description"] }]);
  assert.equal(diffClientTools(CLIENT_TOOLS, CLIENT_TOOLS).match, true);
});

test("--check verdict: an agent without the director tools is drift, and the report says so", () => {
  const withTools = { ...intended, clientTools: CLIENT_TOOLS };
  const agent = matchingAgent();
  const missing = diffAgentConfig(withTools, agent, []);
  assert.equal(missing.ok, false);
  assert.equal(missing.tools.checked, true);
  assert.deepEqual(missing.tools.missing, CLIENT_TOOLS.map((t) => t.name));
  assert.match(formatDriftReport(missing), /client tools\s+✗ DRIFT/);
  const ok = diffAgentConfig(withTools, agent, CLIENT_TOOLS);
  assert.equal(ok.ok, true);
  assert.match(formatDriftReport(ok), /client tools\s+✓ match/);
  // An intent without tools checks none — older callers keep their verdict.
  assert.equal(diffAgentConfig(intended, agent).tools.checked, false);
  assert.equal(diffAgentConfig(intended, agent).ok, true);
});

test("extractLiveToolIds reads conversation_config.agent.prompt.tool_ids defensively", () => {
  assert.deepEqual(extractLiveToolIds({ conversation_config: { agent: { prompt: { tool_ids: ["t1", "", 3, "t2"] } } } }), ["t1", "t2"]);
  assert.deepEqual(extractLiveToolIds({}), []);
});
