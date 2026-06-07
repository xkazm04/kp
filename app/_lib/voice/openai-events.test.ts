// Locks the OpenAI Realtime data-channel wire contract (idea-b70b8bd7): the
// transcript that feeds the Interview→Offer scorecard is assembled from these
// parsed events, so a silently unmatched event type drops turns. The candidate
// side is the asymmetric one — an utterance only becomes a turn on its async
// transcription .completed — and finalize()'s last-answer grace window depends
// on speech_started/completed pairing plus the delta fallback parsed here.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOaiTranscriptEvent } from "./openai.ts";

test("a completed input transcription is the candidate's finished utterance", () => {
  assert.deepEqual(
    parseOaiTranscriptEvent({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "I could start in June.",
    }),
    { kind: "candidateUtterance", text: "I could start in June." },
  );
});

test("a streamed input-transcription delta buffers as candidateDelta (gpt-4o-transcribe path)", () => {
  assert.deepEqual(
    parseOaiTranscriptEvent({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "I could ",
    }),
    { kind: "candidateDelta", text: "I could " },
  );
});

test("VAD speech_started marks a candidate utterance as pending", () => {
  assert.deepEqual(parseOaiTranscriptEvent({ type: "input_audio_buffer.speech_started" }), {
    kind: "candidateSpeechStarted",
  });
});

test("assistant deltas and done keep their kinds — input and output deltas must not cross", () => {
  assert.deepEqual(
    parseOaiTranscriptEvent({ type: "response.output_audio_transcript.delta", delta: "Thanks" }),
    { kind: "assistantDelta", text: "Thanks" },
  );
  assert.deepEqual(parseOaiTranscriptEvent({ type: "response.output_audio_transcript.done" }), {
    kind: "assistantDone",
  });
});

test("malformed payloads and untracked events are ignored, never empty turns", () => {
  // Right type, missing/wrong-typed payload field.
  assert.equal(
    parseOaiTranscriptEvent({ type: "conversation.item.input_audio_transcription.completed" }),
    null,
  );
  assert.equal(
    parseOaiTranscriptEvent({ type: "conversation.item.input_audio_transcription.delta", delta: 7 }),
    null,
  );
  // Untracked event types.
  assert.equal(parseOaiTranscriptEvent({ type: "session.updated" }), null);
  assert.equal(parseOaiTranscriptEvent({}), null);
});
