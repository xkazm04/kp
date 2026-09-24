// The NON-transcript half of the OpenAI Realtime data-channel protocol, parsed in one
// pure place (spark ai-interview-parity).
//
// `app/_lib/voice/openai.ts::parseOaiTranscriptEvent` already owns the transcript
// events. Directing the call needs four more facts the transcript never carries:
//
//   - the model CALLED A TOOL and is blocked on its result;
//   - the candidate STOPPED speaking (the transcript only says they started);
//   - the interviewer's audio STARTED / FINISHED — the "thinking" state and the
//     pre-answer silence both measure from it;
//   - the model began GENERATING a response (thinking, before any audio exists).
//
// It lives beside the transport rather than in the adapter module because it is
// browser-only and because `voice/openai.ts` is the server adapter (it imports
// node:crypto): parsing that belongs to the candidate's bundle should not have to
// travel through it.
//
// Matching is by SUFFIX, exactly like the transcript parser: the Realtime API has
// renamed the same logical event across model lines (`response.audio.delta` →
// `response.output_audio.delta`, and function-call arguments arrive as both
// `response.function_call_arguments.done` and a `function_call` item on
// `response.output_item.done`), so both spellings are accepted and the caller
// de-duplicates by call id.

/** A control action a raw Realtime event implies, or nothing we track. */
export type OaiControlEvent =
  | { kind: "toolCall"; callId: string; name: string; args: unknown }
  | { kind: "candidateSpeechStopped" }
  | { kind: "assistantAudioStarted" }
  | { kind: "assistantAudioDone" }
  | { kind: "responseStarted" };

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Parse one raw data-channel event into the control action it implies, or null.
 *  Guards every field it reads, so a malformed event is ignored rather than turned
 *  into a tool call with an empty name (which the director would answer "continue"
 *  to — correct, but a wasted round trip and a wasted turn of the model's attention). */
export function parseOaiControlEvent(ev: Record<string, unknown>): OaiControlEvent | null {
  const type = str(ev.type);
  if (!type) return null;

  // GA: the arguments are complete and the event names the function.
  if (type.endsWith("function_call_arguments.done")) {
    const callId = str(ev.call_id);
    const name = str(ev.name);
    if (callId && name) return { kind: "toolCall", callId, name, args: ev.arguments };
    // Older lines omit `name` here and only carry it on the item event below; fall
    // through rather than emitting a nameless call.
    return null;
  }

  // Every line emits the finished output item, and a function call is one of them.
  if (type.endsWith("output_item.done")) {
    const item = ev.item;
    if (item !== null && typeof item === "object") {
      const it = item as Record<string, unknown>;
      if (it.type === "function_call") {
        const callId = str(it.call_id);
        const name = str(it.name);
        if (callId && name) return { kind: "toolCall", callId, name, args: it.arguments };
      }
    }
    return null;
  }

  if (type.endsWith("input_audio_buffer.speech_stopped")) return { kind: "candidateSpeechStopped" };
  // `…output_audio.delta` / `…audio.delta`, but NOT `…output_audio_transcript.delta`,
  // which ends in "transcript.delta".
  if (type.endsWith("audio.delta")) return { kind: "assistantAudioStarted" };
  if (type.endsWith("audio.done")) return { kind: "assistantAudioDone" };
  // The model started generating: audio is seconds away, and this is the earliest
  // honest moment to say "thinking" instead of leaving the presence on "listening".
  if (type === "response.created") return { kind: "responseStarted" };
  return null;
}

/** The two messages the browser sends on the director's behalf, as plain objects so
 *  the shapes are pinned by a test instead of by a live provider.
 *
 *  A TOOL RESULT is a `function_call_output` item followed by `response.create` —
 *  the model is blocked on the result, and without the second message it would sit
 *  holding the floor in silence.
 *
 *  A DIRECTIVE is a system message and NOTHING ELSE. No `response.create`: a stage
 *  direction is read before the model's NEXT turn, and forcing a turn out of it would
 *  have the interviewer talk over the candidate mid-answer. `text` already carries the
 *  `[Director] ` prefix from the server — it is injected verbatim. */
export function toolResultMessages(callId: string, output: string): Array<Record<string, unknown>> {
  return [
    { type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } },
    { type: "response.create" },
  ];
}

export function directiveMessage(text: string): Record<string, unknown> {
  return {
    type: "conversation.item.create",
    item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
  };
}
