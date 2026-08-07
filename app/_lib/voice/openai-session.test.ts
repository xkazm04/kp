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

import { buildOpenAiSessionPayload, normalizeTranscriptionLanguage } from "./openai.ts";

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

test("an absent locale yields NO language field — byte-identical to the prior default", () => {
  const withNull = buildOpenAiSessionPayload({ ...base, language: null });
  const withUndef = buildOpenAiSessionPayload({ ...base });
  const expected = {
    session: {
      type: "realtime",
      model: "gpt-realtime",
      instructions: "You are a warm interviewer.",
      audio: {
        input: { transcription: { model: "gpt-4o-transcribe" } },
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
