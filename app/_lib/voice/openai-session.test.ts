// Locks the OpenAI Realtime session-payload builder (idea: language enforcement
// parity for OpenAI). The voice harness proved a prompt-level language lock loses
// to the transport config ~2/3 of the time, so the candidate locale must reach
// the input-audio transcription config — otherwise Czech speech transcribes
// against an English default. These pin: (a) a known locale sets transcription
// .language in ISO-639-1, (b) an unknown/absent locale leaves the payload
// byte-identical to the prior bilingual-open default, (c) the configured
// transcription model is preserved.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildOpenAiSessionPayload,
  coerceTurnEagerness,
  DEFAULT_TURN_EAGERNESS,
  normalizeTranscriptionLanguage,
  openAiTurnEagerness,
} from "./openai.ts";
import { DIRECTOR_TOOL_DEFS } from "./director-tools.mjs";

const base = {
  model: "gpt-realtime",
  instructions: "You are a warm interviewer.",
  transcriptionModel: "gpt-4o-transcribe",
  voice: "marin",
};

test("a known locale pins the transcription language and keeps the model", () => {
  const { session } = buildOpenAiSessionPayload({ ...base, language: "cs" });
  const audio = session.audio as { input: { transcription: { model: string; language?: string } } };
  assert.equal(audio.input.transcription.model, "gpt-4o-transcribe");
  assert.equal(audio.input.transcription.language, "cs");
});

test("a BCP-47 region tag is narrowed to the ISO-639-1 primary subtag", () => {
  const { session } = buildOpenAiSessionPayload({ ...base, language: "en-US" });
  const audio = session.audio as { input: { transcription: { language?: string } } };
  assert.equal(audio.input.transcription.language, "en");
});

test("an absent locale yields NO language field — the rest of the payload is the conversational default", () => {
  const withNull = buildOpenAiSessionPayload({ ...base, language: null });
  const withUndef = buildOpenAiSessionPayload({ ...base });
  // UPDATED DELIBERATELY (spark ai-interview-parity): a conversational (non-relay)
  // session now carries semantic_vad at the house eagerness ("low") — the interviewer
  // waits for a finished thought instead of a silence threshold. Everything else is
  // the prior default, and no tool fields appear without tools.
  const expected = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions: "You are a warm interviewer.",
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe" },
          turn_detection: { type: "semantic_vad", eagerness: "low" },
        },
        output: { voice: "marin" },
      },
    },
  };
  assert.deepEqual(withNull, expected);
  assert.deepEqual(withUndef, expected);
  // No `language` key present at all (not just undefined).
  const t = (withNull.session.audio as { input: { transcription: object } }).input.transcription;
  assert.equal("language" in t, false);
});

test("normalizeTranscriptionLanguage: valid two-letter passes, malformed → null", () => {
  assert.equal(normalizeTranscriptionLanguage("cs"), "cs");
  assert.equal(normalizeTranscriptionLanguage("EN"), "en");
  assert.equal(normalizeTranscriptionLanguage("cs-CZ"), "cs");
  assert.equal(normalizeTranscriptionLanguage(null), null);
  assert.equal(normalizeTranscriptionLanguage(undefined), null);
  assert.equal(normalizeTranscriptionLanguage(""), null);
  assert.equal(normalizeTranscriptionLanguage("english"), null);
  assert.equal(normalizeTranscriptionLanguage("123"), null);
});

// ── Director tools + semantic VAD (spark ai-interview-parity) ────────────────
// Verified against the Realtime GA schema for POST /v1/realtime/client_secrets
// (developers.openai.com, 2026-09-18): session.tools is a list of
// { type: "function", name, description, parameters }, session.tool_choice takes
// "auto" | "none" | "required", and audio.input.turn_detection accepts
// { type: "semantic_vad", eagerness: "low" | "medium" | "high" | "auto" }.

test("director tools are minted as GA function tools with tool_choice auto", () => {
  const { session } = buildOpenAiSessionPayload({ ...base, tools: DIRECTOR_TOOL_DEFS });
  const tools = session.tools as { type: string; name: string; description: string; parameters: unknown }[];
  assert.equal(session.tool_choice, "auto");
  assert.equal(tools.length, DIRECTOR_TOOL_DEFS.length);
  DIRECTOR_TOOL_DEFS.forEach((def, i) => {
    assert.deepEqual(tools[i], { type: "function", name: def.name, description: def.description, parameters: def.parameters });
  });
});

test("no tools (absent or empty) means no tool fields at all", () => {
  for (const tools of [undefined, null, []]) {
    const { session } = buildOpenAiSessionPayload({ ...base, tools });
    assert.equal("tools" in session, false);
    assert.equal("tool_choice" in session, false);
  }
});

test("relay mode (role intake) is byte-unchanged — no semantic VAD, and tools are ignored", () => {
  const expected = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions: "You are a warm interviewer.",
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe", language: "cs" },
          turn_detection: { type: "server_vad", create_response: false, interrupt_response: true },
        },
        output: { voice: "marin" },
      },
    },
  };
  assert.deepEqual(buildOpenAiSessionPayload({ ...base, language: "cs", relay: true }), expected);
  assert.deepEqual(
    buildOpenAiSessionPayload({ ...base, language: "cs", relay: true, tools: DIRECTOR_TOOL_DEFS, turnEagerness: "high" }),
    expected,
    "relay never answers on its own, so it never gets tools or a semantic eagerness"
  );
});

test("a conversational session takes the eagerness it is given", () => {
  const { session } = buildOpenAiSessionPayload({ ...base, turnEagerness: "medium" });
  const input = (session.audio as { input: { turn_detection: unknown } }).input;
  assert.deepEqual(input.turn_detection, { type: "semantic_vad", eagerness: "medium" });
});

test("OPENAI_REALTIME_TURN_EAGERNESS: legal values pass, anything else falls back to low", () => {
  assert.equal(DEFAULT_TURN_EAGERNESS, "low");
  for (const v of ["low", "medium", "high", "auto"]) assert.equal(coerceTurnEagerness(v), v);
  assert.equal(coerceTurnEagerness(" HIGH "), "high", "casing and whitespace are not a new value");
  for (const v of [undefined, null, "", "eager", "0", 3]) assert.equal(coerceTurnEagerness(v), "low");
  const prior = process.env.OPENAI_REALTIME_TURN_EAGERNESS;
  try {
    delete process.env.OPENAI_REALTIME_TURN_EAGERNESS;
    assert.equal(openAiTurnEagerness(), "low");
    process.env.OPENAI_REALTIME_TURN_EAGERNESS = "auto";
    assert.equal(openAiTurnEagerness(), "auto");
    process.env.OPENAI_REALTIME_TURN_EAGERNESS = "nonsense";
    assert.equal(openAiTurnEagerness(), "low");
  } finally {
    if (prior === undefined) delete process.env.OPENAI_REALTIME_TURN_EAGERNESS;
    else process.env.OPENAI_REALTIME_TURN_EAGERNESS = prior;
  }
});
