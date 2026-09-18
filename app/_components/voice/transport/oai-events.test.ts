// The OpenAI Realtime control protocol, pinned (spark ai-interview-parity).
//
// No key and no browser can reach this provider from CI, so the wire contract is a
// test over recorded event shapes. The failure it guards against is silent: a typo in
// one suffix means the model's tool call never reaches the director, the model waits
// on a result that never comes, and the interview simply stops — with no error
// anywhere.
//
// Runner: node --test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { directiveMessage, parseOaiControlEvent, toolResultMessages } from "./oai-events.ts";
import { DIRECTOR_NOTE_PREFIX } from "@/app/_lib/voice/director-types.ts";

test("a GA function-call completion is a tool call", () => {
  assert.deepEqual(
    parseOaiControlEvent({
      type: "response.function_call_arguments.done",
      call_id: "call_a1",
      name: "mark_topic_covered",
      arguments: '{"block_id":"b2","evidence_quote":"we cut it to twenty minutes"}',
    }),
    {
      kind: "toolCall",
      callId: "call_a1",
      name: "mark_topic_covered",
      args: '{"block_id":"b2","evidence_quote":"we cut it to twenty minutes"}',
    },
  );
});

test("the older spelling — the name only on the finished output item — is the same tool call", () => {
  assert.deepEqual(
    parseOaiControlEvent({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: "call_b2", name: "begin_topic", arguments: { block_id: "b1" } },
    }),
    { kind: "toolCall", callId: "call_b2", name: "begin_topic", args: { block_id: "b1" } },
  );
});

test("arguments ride through UNPARSED — the provider hands back a JSON string or an object", () => {
  // The director's parser accepts both (`args: unknown`), so the browser must not
  // guess: a JSON.parse here would turn a provider quirk into a dropped tool call.
  const asString = parseOaiControlEvent({
    type: "response.function_call_arguments.done",
    call_id: "c",
    name: "begin_topic",
    arguments: '{"block_id":"b1"}',
  });
  assert.equal(typeof (asString as { args: unknown }).args, "string");
});

test("a nameless or idless function call is NOT a tool call", () => {
  // Better a missed direction than a call the director answers "continue" to while
  // the model waits for something that identifies what it asked.
  assert.equal(parseOaiControlEvent({ type: "response.function_call_arguments.done", call_id: "c", arguments: "{}" }), null);
  assert.equal(parseOaiControlEvent({ type: "response.function_call_arguments.done", name: "begin_topic" }), null);
  assert.equal(parseOaiControlEvent({ type: "response.output_item.done", item: { type: "message" } }), null);
  assert.equal(parseOaiControlEvent({ type: "response.output_item.done", item: null }), null);
  assert.equal(parseOaiControlEvent({ type: "response.output_item.done" }), null);
});

test("speech stop, assistant audio start/stop and generation start", () => {
  assert.deepEqual(parseOaiControlEvent({ type: "input_audio_buffer.speech_stopped" }), { kind: "candidateSpeechStopped" });
  assert.deepEqual(parseOaiControlEvent({ type: "response.output_audio.delta", delta: "…" }), { kind: "assistantAudioStarted" });
  assert.deepEqual(parseOaiControlEvent({ type: "response.audio.delta", delta: "…" }), { kind: "assistantAudioStarted" });
  assert.deepEqual(parseOaiControlEvent({ type: "response.output_audio.done" }), { kind: "assistantAudioDone" });
  assert.deepEqual(parseOaiControlEvent({ type: "response.audio.done" }), { kind: "assistantAudioDone" });
  assert.deepEqual(parseOaiControlEvent({ type: "response.created" }), { kind: "responseStarted" });
});

test("the audio suffixes do not swallow the TRANSCRIPT deltas", () => {
  // `response.output_audio_transcript.delta` ends in "transcript.delta", and it is
  // the interviewer's live caption — parsing it as "audio started" would leave the
  // transcript half of the protocol reading an empty stream.
  assert.equal(parseOaiControlEvent({ type: "response.output_audio_transcript.delta", delta: "Hello" }), null);
  assert.equal(parseOaiControlEvent({ type: "response.output_audio_transcript.done" }), null);
  assert.equal(parseOaiControlEvent({ type: "conversation.item.input_audio_transcription.delta", delta: "hi" }), null);
});

test("anything else, and anything malformed, is ignored", () => {
  assert.equal(parseOaiControlEvent({}), null);
  assert.equal(parseOaiControlEvent({ type: 42 }), null);
  assert.equal(parseOaiControlEvent({ type: "session.updated" }), null);
});

test("a tool result is the output item AND the response that unblocks the model", () => {
  const msgs = toolResultMessages("call_a1", "Recorded.");
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs[0], {
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: "call_a1", output: "Recorded." },
  });
  assert.deepEqual(msgs[1], { type: "response.create" });
});

test("a directive is a system message and NOTHING else — no response.create", () => {
  // A stage direction is read before the model's NEXT turn. Forcing a response would
  // have the interviewer start talking over a candidate who is mid-answer.
  const text = `${DIRECTOR_NOTE_PREFIX} Move on to b3 · Wrap-up.`;
  const msg = directiveMessage(text);
  assert.deepEqual(msg, {
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
  });
  assert.ok(!JSON.stringify(msg).includes("response.create"));
});

test("the directive's prefix is the server's, applied ONCE", () => {
  // director-types.ts documents `directive.text` as already prefixed. Re-prefixing
  // here would send "[Director] [Director] …", which the brief never described.
  const fromServer = `${DIRECTOR_NOTE_PREFIX} Ask one narrower question.`;
  const item = directiveMessage(fromServer).item as { content: Array<{ text: string }> };
  assert.equal(item.content[0].text, fromServer);
  assert.equal(item.content[0].text.indexOf(DIRECTOR_NOTE_PREFIX), item.content[0].text.lastIndexOf(DIRECTOR_NOTE_PREFIX));
});
