// The `<<END>>` close sentinel is an ENGINE WIRE CONTRACT, not copy.
// pipeline/jobfit/intake.py appends it to the agent's FINAL utterance on both
// paths — the persona rule ("append <<END>> to that final utterance") and the
// scripted keyless `_close_reply` — and `done` is derived from its presence.
//
// It must never reach the stored transcript, the requestor's screen, or the
// voice transport: `speakText` (app/_components/voice/transport/openai.ts)
// tells the provider to say the reply "exactly, verbatim … do not add,
// translate, or omit anything", so an unstripped sentinel is READ ALOUD as the
// closing line of the call, and `spokenOpener` would speak it again on the
// next connect.
//
// Stripped at the route boundary of BOTH planes (message + voice-turn) so the
// text and voice transcripts agree; pinned by reply-sentinel.test.ts.
export function stripEndSentinel(reply: string): string {
  return reply.replace(/\s*<<END>>\s*/g, " ").trim();
}
