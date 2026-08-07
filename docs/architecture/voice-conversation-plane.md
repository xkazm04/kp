# Voice conversation plane — transport-only providers, our brain

Status: implemented for the role-intake dialog (2026-08-07); the candidate
voice interview still runs the older provider-brain design (migration is
future work, see the end). Companion feature doc:
[docs/features/intake/README.md](../features/intake/README.md).

## The principle

**A realtime voice provider is a speech transport, never the conversational
brain.** The provider does exactly three things: stream the user's audio in
and transcribe it (VAD-segmented utterances), speak the text we hand it, and
signal barge-in. Conversation direction, persona, state, and extraction are
OURS, server-side. This is what removes the vendor lock: any provider that can
transcribe and speak-on-command can carry the conversation, the persona/brief
never leave our infrastructure, and a mid-call transport swap loses nothing
because the transcript and brief are server truth after every exchange.

```
 mic ──▶ VoiceTransport (provider: STT + VAD + TTS, relay mode) ──▶ utterance text
                                                                        │
                              speak(text) ◀── FAST THREAD (role_intake_voice):
                                              /api/intake/[id]/voice-turn
                                              → run_voice_turn — persona +
                                                CAPTURED/MISSING digest +
                                                recent turns → next utterance
                                                (plain text, ~seconds)
                                                                        │
                              live brief panel ◀── PERIODIC THREAD (role_intake):
                                                   /voice-complete (no body,
                                                   every EXTRACT_EVERY exchanges
                                                   + at hang-up) → extract_transcript
                                                   → merge_brief (stated survives)
```

## The two LLM threads

The full text-plane exchange (reply + full RoleBrief re-extraction as one JSON
completion) runs 30–40 s — unusable at speech pace. So the work splits:

- **Fast thread** (`run_voice_turn`, use case **`role_intake_voice`**): a lean
  plain-text completion — persona + a compact CAPTURED/STILL-MISSING brief
  digest (`brief_gap_summary`) + the last 12 turns → the next spoken utterance
  only. No JSON contract (the use case declares no JSON capability). Pin a
  fast model to it via the normal llm-config machinery without touching the
  text dialog's routing. 30 s CLI timeout: a stalling provider falls to the
  deterministic script rather than stalling the call.
- **Periodic extraction thread** (the existing `role_intake` extraction):
  every `EXTRACT_EVERY` exchanges (and at hang-up) the client fires
  `/voice-complete` with no body; the server runs `extract_transcript` over
  the STORED transcript through the same coerce + `merge_brief` path as text —
  prior `stated` content survives, provenance discipline applies. The live
  brief panel therefore fills DURING the call, lagging the conversation by up
  to a couple of exchanges — honest lag, by design.

## Keyless honesty

- No voice provider → the mic button is a quiet "not configured" note; text
  untouched.
- No LLM mid-call → **the scripted slot engine IS the fast thread**:
  `deterministic_turn` answers in milliseconds and extracts inline, so a
  keyless voice call still works end to end (`source: deterministic`, brief
  updates ride each turn).
- No LLM at extraction time → `extracted: false`: transcript stored, brief
  untouched, the UI says so. Nothing is silently invented from free speech.

## Resilience

- **State is server truth after every exchange** (`/voice-turn` persists the
  pair before returning), so a drop or transport swap loses at most the
  utterance in flight — the client's recovery path posts strays (in-flight +
  queued + half-transcribed) via `/voice-complete {turns}`.
- **Transport failover**: the adapter layer's availability/failover machinery
  applies unchanged; because the session carries only the persona-free RELAY
  instruction, reconnecting on a different provider mid-conversation is a
  credential mint, not a context migration.
- The client orchestrator (`voiceOrchestration.ts`, pure + unit-tested)
  serializes fast-turn calls and coalesces utterances spoken while one is in
  flight; barge-in cancels the current spoken reply.

## Provider surface (implemented vs designed)

- **OpenAI Realtime — implemented.** `relay: true` in the session payload
  (`buildOpenAiSessionPayload`) sets `turn_detection.create_response: false`
  (VAD + transcription stay on, the model never self-responds); replies are
  injected with `speakText` (`response.create` pinned to verbatim delivery)
  and `cancelSpeech` handles barge-in.
- **ElevenLabs — designed, not wired.** With the brain out of the provider,
  EL's client-sent-prompt seam stops being an architectural blocker: the
  prompt it would receive is the same persona-free relay instruction. Wiring
  its transport (their conversational WS or TTS+STT primitives) is a
  contained adapter task. Residual exposure — the AUDIO transits the
  provider's infrastructure under their retention terms — is a
  **Terms-of-Service disclosure item, not an architecture dependency**;
  suggested disclosure line: *"Voice conversations are transcribed through a
  third-party speech provider (OpenAI or ElevenLabs); audio transits their
  infrastructure under their data-processing terms. The conversation content,
  the AI's reasoning, and your hiring data never leave this platform."*

## Future work

- Migrate the candidate voice interview to this plane (it still ships the
  provider-brain design with the candidate-safe-brief apparatus; the relay
  design would retire the client-sent-prompt security seam wholesale).
- Latency dressing: a short localized filler ("moment…") when the fast thread
  exceeds ~3 s, and streamed TTS of partial replies.
- Harness: drive this plane with the existing audio-in-the-loop rig
  (`pipeline/jobfit/eval/voice/` — Piper TTS + headless transport) against
  `run_voice_turn`, mirroring the candidate-side V0 smoke.
