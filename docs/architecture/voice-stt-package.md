# Transcription — the portable multi-provider STT package

Status: shipped 2026-09-01. Package at [`packages/voice-stt`](../../packages/voice-stt/README.md),
bound into kp by `app/_lib/stt.ts`, served by `app/api/stt/route.ts`. The cross-app standard
lives in the ai-registry (`voice-io` → techniques `stt-pipeline`, `engine-abstraction`,
`on-device-vs-cloud`, `portable-provider-package`); this page is kp's realization of it.

It is the sibling of [voice-tts-package.md](./voice-tts-package.md) and deliberately not a
merge of it. Read that one first if you only have time for one: the seam, the probe states
and the preference story are identical by design, and everything below is the part that had
to be different.

## Three voice planes, three registries

| Plane | What it is | Registry | Preference var |
| --- | --- | --- | --- |
| **Conversation** | a live duplex session: the provider listens, (sometimes) decides, and speaks | `app/_lib/voice/` (`VoiceAdapter`) | `KP_VOICE_PROVIDER` (openai \| elevenlabs) |
| **Spoken output** | text → one audio clip, no listening | `packages/voice-tts` (`TtsProvider`) | `KP_TTS_PROVIDER` + `KP_TTS_PROVIDERS` |
| **Transcription** | one audio clip → text, no speaking | `packages/voice-stt` (`SttProvider`) | `KP_STT_PROVIDER` + `KP_STT_PROVIDERS` |

Why three and not one settings row: a conversation provider owns turn-taking and barge-in
and is priced per minute; a TTS provider owns one utterance and is priced per character or
runs free on-device; an STT provider owns one recording, is priced per audio hour, and is
the only one of the three that handles **a person's voice rather than the product's own
words**. That last asymmetry is where this package stops being a copy of its sibling.

## What is different from the synthesis package, and why

### 1. The vocabulary is ordered on-device first

`STT_PROVIDER_IDS = ["whisper_cpp", "assemblyai"]`, and that order is policy: with nothing
configured, the registry serves the first ready provider in registration order. Synthesis
can lead with the cloud without anyone being harmed — it speaks kp's own sentence. Input
cannot: a default that ships a candidate's voice to a vendor because it happened to be
listed first is a residency decision nobody made. `preferenceFromEnv` is tested on exactly
this (`registry.test.ts`, "defaults on-device first").

### 2. Resolution is capability-gated, not just probe-gated

`resolve(requested, needs)` filters the order by `SttNeeds` **before** it probes:

```ts
type SttNeeds = { diarization?: boolean; redaction?: boolean; onDevice?: boolean };
```

Synthesis may fall back from a fast voice to a slow one and the user hears the same words in
a different voice. Transcription may not fall back from a redacting engine to a
non-redacting one, because **the words themselves change, and the ones that appear are
exactly the ones somebody asked to have removed**. So an engine that cannot meet the need is
not in the order at all, and when none can, the answer is a typed `unsupported` naming the
missing capability — `422`, never a `200` carrying the un-redacted transcript.

`needs.onDevice` is a per-request floor. It can refuse the cloud for one sensitive clip on a
deploy that allows both; it can never admit a provider `KP_STT_PROVIDERS` excludes.

### 3. `diarized` / `redacted` report what the engine DID

Both fields are read back off the engine's answer, never echoed from the request. A surface
that prints "redacted" reads the response field. `AssemblyAiStt` derives `diarized` from
whether utterances actually came back, not from whether `speaker_labels` was sent, and
`redacted` from the transcript row's `redact_pii` — the vendor echoes the **accepted** job
configuration onto every row it returns, which is the only field in the API that can
disagree with the request. When it does disagree in the dangerous direction (asked for,
row says `false`), the adapter throws `unsupported` instead of returning a transcript whose
`redacted: false` a caller might not read. When the row omits the field entirely the
property is simply not claimed — an unproven `redacted: true` is the one lie this package
must never tell.

### 3b. A declared ceiling is enforced or it is a comment

Every adapter declares `capabilities.maxClipSeconds`; for months nothing read it. The
dispatch door now refuses a clip past the serving engine's ceiling with `too_long`, using
the duration `node/wav.ts` reads out of the RIFF header — so the refusal costs neither a
subprocess nor an audio-hour. It is honestly partial: a compressed container's length lives
behind a decoder this package deliberately does not carry, so for `mpeg`/`mp4`/`webm`/
`ogg`/`flac` the engine's own limit is still the first thing that says no.

### 4. Failure states the synthesis side does not have

- **Wrong container.** The package does not transcode. `node/wav.ts` reads a header and
  nothing else — deliberately no decoder and no ffmpeg shell-out, because a package that
  quietly resamples has taken on a dependency, a failure mode and a CPU budget the host did
  not agree to. whisper.cpp gets a typed `invalid_audio` naming the fix ("needs 16 kHz PCM
  WAV; this clip is 44100 Hz") instead of a silent conversion that works until it does not.
- **A model that cannot serve the language.** `ggml-base.en.bin` asked for Czech returns
  confident English nonsense, which is worse than a refusal because it looks like a
  transcript. The adapter prefers a multilingual model and refuses the mismatch by name.

### 5. The scratch dir is a privacy control, not a convenience

`withScratchDir` writes the clip to the OS temp folder for the local engine and removes it in
a `finally`. What lands there is a candidate's voice, so callers never own that cleanup.
The host's log sink is capped to lengths and timings for the same reason — never the
transcript, never the audio (`app/_lib/stt.ts`).

## Providers shipped

| id | kind | needs | notes |
| --- | --- | --- | --- |
| `whisper_cpp` | local | `whisper-cli` (or the pre-rename `main`) via `WHISPER_BIN` / `<VOICE_SIDECAR_HOME>/bin`, plus a `ggml-*.bin` in `WHISPER_MODEL_DIR` (default `<cwd>/data/whisper`) or `<sidecar home>/whisper` | multilingual incl. **Czech**; 16 kHz PCM WAV only; no diarization, no redaction; `WHISPER_THREADS`, `WHISPER_TIMEOUT_MS` |
| `assemblyai` | cloud | `ASSEMBLYAI_API_KEY` (+ `ASSEMBLYAI_BASE_URL`, `ASSEMBLYAI_MODEL`, `ASSEMBLYAI_PII_POLICIES`, `ASSEMBLYAI_PII_SUB`) | async upload → submit → poll; diarization and PII redaction; billed per audio hour |

Both resolve local engines through the **same** `VOICE_SIDECAR_HOME` the TTS package uses
(`~/.personas/companion-tts`). One machine has one folder of voice engines — not one per
direction and not one per app — so the first product to install an engine installs it for
every product on the box.

### Why AssemblyAI, and the three facts an operator must be told

It is not an ElevenLabs alternative. ElevenLabs is the output direction (and the duplex
agent); this is the input one, and an operator picking between them is answering two
different questions.

1. **Language.** This adapter is the **async** path, whose catalog is wide and includes
   Czech. Its `language_code` vocabulary is primary subtags (`cs`, `de`) plus a handful of
   underscore-delimited English variants (`en_us`, `en_au`) — *not* hyphenated BCP-47
   regionals, which is what this package's validation door normalizes a request to. So the
   adapter narrows the hint to its primary subtag and lets the service pick the regional
   model; asking for a specific `en_*` variant is a `modelId` / `ASSEMBLYAI_MODEL` decision,
   which is where an account-level vocabulary belongs.

   The vendor's **real-time** multilingual model is en/es/fr/de/it/pt only — no Czech —
   which is why the streaming transport is *not* quietly wired in behind the same id. A
   streaming adapter is a different seam (a socket, not a request) and would need its own
   language row.
2. **Residency.** The audio leaves the machine. `ASSEMBLYAI_BASE_URL` selects a data zone
   (the EU one keeps audio and transcripts in the EU, at no price premium), and
   `whisper_cpp` exists so that not sending it at all stays a real option.
3. **Money.** Billed per audio hour, with diarization and redaction as priced add-ons. The
   route throttles (20/10 min per IP, pinned in `app/api/rate-limit-contract.test.ts`), the
   probe spends nothing (a `limit=1` list read), and the adapter **never retries a
   submission on its own** — a retry here is a second charge, and that is the host's call.

Deliberately **not** adopted from the vendor's catalog: sentiment analysis, entity-based
topic detection and content moderation over candidate speech. Drawing conclusions about a
person from how they talk is a different craft with its own standards, and one this product
does not get to do quietly through an add-on checkbox. The LLM Gateway / LeMUR tier is
redundant here — kp already has `app/_lib/llm-config.ts`.

## The host wrapper

```
GET  /api/stt   -> { providers: SttStatus[], preferred, allowed }   probe only, spends nothing
POST /api/stt   multipart: audio=<File>, language?, provider?, model?,
                diarize?, redact?, onDevice?  -> a transcript as JSON
```

Operator-gated (defense in depth), per-IP throttled, and gated by
`validateAudioUploadServer` — the audio twin of the document upload gate in
`app/_lib/upload-constraints.ts`: a **different ceiling** (25 MB, audio MIME) reaching the
**same two statuses** (413 too big, 400 wrong kind), because that pairing is what lets a
client branch without knowing which endpoint it hit. The boundary's MIME list is a copy of
the package's `STT_MIME_TYPES`, and `upload-constraints.test.ts` asserts the two agree.

Error mapping, in one place:

| `SttErrorCode` | status |
| --- | --- |
| `invalid_audio`, `invalid_language`, `invalid_model` | 400 |
| `too_long` — well-formed audio, longer than the serving engine's `maxClipSeconds` | **413** |
| `unsupported` — well-formed request, healthy engines, capability not on offer | **422** |
| `rate_limited` — the engine asked us to slow down | **429**, plus `Retry-After` from `err.retryAfterMs` when the engine said how long |
| `unavailable` — nothing ready, with the last probe's reason | 503 |
| `timeout` | 504 |
| `engine_failed`, `aborted` | 502 |

`too_long` is 413 rather than 400 for the same reason the upload gate answers 413 for too
many bytes: a client branches on "too much audio" once, whether the excess is size or
length. `rate_limited` exists so a vendor's concurrency ceiling does not reach an operator
as "the engine broke" — the two have opposite next actions (wait and repeat vs. investigate),
and the adapter keeps a cached positive probe across a 429 because busy is not down.

**Every refusal carries a CODE, never an English sentence** (api-contracts.md §1.1). The
boundary refusals resolve through `REFUSAL_ERRORS`: `AUDIO_MISSING` (no multipart body, no
`audio` part, or an empty one), `AUDIO_UNSUPPORTED_TYPE`, `AUDIO_TOO_LARGE`,
`TOO_MANY_REQUESTS` (the per-IP throttle AND the engine's own `rate_limited`, so a client
backs off from both the same way) and `STT_TOO_LONG` for the engine's `too_long`.
`validateAudioUploadServer` returns `{ status, code }` rather than a sentence, and the 500
is `safeJsonError(err, "api:stt", "STT_FAILED")` — the adapter's message (which can carry a
vendor HTTP body or a local model path) goes to the server log only. The code -> status
table is pinned by invoking the handler in `app/api/stt/stt-route.test.ts`.

The ENGINE branch joined them on 2026-09-05. It used to send `{ error: err.message }`, and
that message is the adapter's English ("OPENAI_API_KEY is not set", a whisper.cpp stderr
tail) — the one thing a client may not render. Every remaining engine failure now answers
`safeJsonError(err, "api:stt:engine", "STT_FAILED", STT_ERROR_STATUS[err.code] ?? 502)`:
the error whole to the server log, `STT_FAILED` plus its registry sentence on the wire, and
the engine's own status kept. `provider` left the body with the message; nothing read it.

The served engine travels in headers (`x-stt-provider`, `x-stt-elapsed-ms`,
`x-stt-fallback-from`) and in the body's `fallbackFrom`, so a fallback is visible at every
boundary that renders it.

## Deployment shapes

One package, two shapes, no code fork — the allowed set does the work:

| Shape | Setting | Consequence |
| --- | --- | --- |
| Local install / evaluation | leave both vars unset | every registered provider is offered; on-device leads; a missing engine reports `absent` with its setup hint |
| BYO key | `KP_STT_PROVIDER=assemblyai` | the operator's own key, their own bill |
| Residency-locked team deploy | `KP_STT_PROVIDERS=whisper_cpp` | audio cannot leave the machine, and no per-request field can widen it |

## Known gaps

- **No streaming transport.** Every adapter declares `streaming: false`. Live interview
  transcription today comes from the conversation provider's own session
  (`app/_lib/voice/`), not from this package. A socket-shaped adapter is the next seam, and
  it must carry its own language row (see the Czech constraint above).
- **No consumer in the product yet.** The package, the binding and the route are in; no kp
  surface calls `/api/stt`. The intended first consumers are post-hoc transcription of a
  completed interview session and the GDPR redaction pass over a stored transcript.
- **No onboarding step.** The install/BYO-key choice is documented in
  `.claude/onboarding/config.md` (the CLI skill) but the product's first-run wizard
  (`app/features/shell/setup/`) still has no engine or key step for any of the three voice
  planes. That is the next piece of work, and it is what the probe-only `GET` exists to feed.
- **Two adapter behaviours are unverified against a live engine.** The cloud path's
  `redact_pii` read-back and the 429 mapping are pinned by a scripted `fetch`
  (`packages/voice-stt/src/providers/adapters.test.ts`), not by a real key; the local
  probe cache and its invalidation are pinned by a counting host, not by a real
  `whisper-cli`. Both are the shapes the vendor and the CLI document, and both would show
  up first as a live smoke test on the day the first consumer lands.
- **The local probe is cached for 60 s.** The same TTL the cloud adapter uses, against a
  different cost (a readdir + stat per model directory on every resolve). Installing a model
  therefore takes up to a minute to show as `ready` in a settings surface; a real transcribe
  failure invalidates it immediately.
- **PII policy names are unverified against a live key.** `DEFAULT_PII_POLICIES` is the
  vendor's vocabulary, not ours; a rejected policy surfaces as the API's 400 body verbatim,
  and `ASSEMBLYAI_PII_POLICIES` overrides the list without a code change.
