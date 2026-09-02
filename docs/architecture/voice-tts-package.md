# Spoken output — the portable multi-provider TTS package

Status: shipped 2026-08-23. Package at [`packages/voice-tts`](../../packages/voice-tts/README.md),
bound into kp by `app/_lib/tts.ts`, served by `app/api/tts/route.ts`, compared by ear in
`app/_components/voice/TtsComparePanel.tsx` on `/interview-lab`. The cross-app standard
lives in the ai-registry (`voice-io` → technique `portable-provider-package`); this page is
kp's realization of it.

## Three voice planes, one preference story

kp handles voice in three different ways, and they are deliberately separate registries:

| Plane | What it is | Registry | Preference var |
| --- | --- | --- | --- |
| **Conversation** | a live duplex session: the provider listens, (sometimes) decides, and speaks — OpenAI Realtime, ElevenLabs Agents, or a self-hosted Agents-protocol server | `app/_lib/voice/` (`VoiceAdapter`) | `KP_VOICE_PROVIDER` (openai \| elevenlabs), honored by `pickDefaultProvider` only when that provider is configured |
| **Spoken output** | text → one audio clip, no listening | `packages/voice-tts` (`TtsProvider`) | `KP_TTS_PROVIDER` (preferred) + `KP_TTS_PROVIDERS` (compare set) |
| **Transcription** | one audio clip → text, no speaking — see [voice-stt-package.md](./voice-stt-package.md) | `packages/voice-stt` (`SttProvider`) | `KP_STT_PROVIDER` + `KP_STT_PROVIDERS` |

The onboarding skill (`/onboarding voice`) asks the first two questions and writes both
vars. They are not merged on purpose: a conversation provider owns turn-taking and barge-in
and is priced per minute; a TTS provider owns one utterance and is priced per character or
runs free on-device; an STT provider owns one recording, is priced per audio hour, and is
the only one of the three whose input is a person's voice rather than kp's own words — which
is why its package makes on-device the default and gates resolution on capabilities the
other two do not have. The registry's `duplex-agent-sessions` technique governs the first,
this package the second, `stt-pipeline` + `on-device-vs-cloud` the third.
The relay-mode path (`docs/architecture/voice-conversation-plane.md`) is where they will
meet: a transport-only conversation provider's `speak(text)` can be served by this package,
and its listening half by the STT one, once a streaming local engine is worth it.

## The package contract (what makes it reusable)

- **Zero host imports.** `packages/voice-tts/src` imports only Node builtins and (for the
  hook) React. Everything app-specific — secrets, home dir, cwd, logging — arrives through
  one `TtsHost` object. Copy or link the directory into another app and bind a different
  host; nothing else changes.
- **One interface, one dispatch door.** `TtsProvider { id, kind, requiredEnv, capabilities,
  probe(), voices(), synthesize() }`. Apps call `createTts().speak()`, never an adapter;
  `speak()` runs every request through the one validation door (`validate.ts`: 1200-char
  cap, voice-id charset allowlist, language shape, speed clamp) and serializes local
  sidecars (a one-shot process reloads its model per call).
- **Capabilities, not identities.** `TTS_PROVIDER_IDS` is the closed vocabulary; UI and
  preference parsing derive from it. Surfaces branch on `capabilities.onDevice`,
  `languages`, `speed` — never on `id`.
- **Absent ≠ broken ≠ ready.** `probe()` distinguishes not-installed (with a `setup` hint)
  from installed-but-failing (with the reason) from ready, and probes the real artifact
  (binary on disk, `model.onnx` present, cloud key accepted) rather than a settings flag.
- **Fallback is visible.** `resolve()` walks requested → preferred → first allowed+ready and
  returns `fallbackFrom`; the route forwards it as `X-Tts-Fallback-From` and the panel says
  "fell back from X". Nothing ready → typed `TtsError("unavailable")` with the last reason,
  never an empty 200.
- **Retired ids normalize on read.** `preferenceFromEnv` drops unknown ids instead of
  throwing, so a stale `KP_TTS_PROVIDER` never wedges the app.
- **A failure is a next action, not a message.** `TtsErrorCode` names what the caller should
  do: `invalid_text`/`invalid_voice` (fix the request), `unavailable` (no engine can speak —
  credentials, entitlement, nothing installed), `rate_limited` (the engine is HEALTHY and the
  same request succeeds later — with `retryAfterMs` when the service said how long),
  `timeout`, `aborted`, `engine_failed`. Added 2026-09-02: the cloud adapter used to map 401
  to `unavailable` and everything else — quota, a wrong voice id, a transient 5xx — to
  `engine_failed`/502, so a surface could not tell "add credits" from "try again in a
  minute". See the mapping table under *Host wrapper*.
- **The test seam is the interface.** `providers/fake.ts` scripts probe outcomes, failures,
  `capabilities` overrides (`maxClipChars`, which makes the segment-and-join path reachable
  without a 1200-char fixture) and a `gate`/`trace` pair that turns concurrency into an
  observable order. `registry.test.ts` covers the door, the resolution order, visible
  fallback, the unavailable path, segment-and-join and local serialization;
  `providers/elevenlabs.test.ts` pins the whole HTTP status → code table against a `fetch`
  double. No audio hardware, no network, no model files.

## Chat quality: speech-ready text and chunked playback (deepen round, 2026-08-23)

- **`speechReady(text)`** (`packages/voice-tts/src/text/normalize.ts`) turns an assistant reply
  into speakable text: fenced code/tables/images/URLs/emails removed (optional spoken
  stand-ins), link anchor text kept, emphasis/heading/bullet markers dropped, every line
  terminated with punctuation, emoji dropped. It does **not** expand numbers — Czech expansion
  is grammatical (cases, currency forms) and belongs to a per-locale normalizer kp does not
  have yet. Applied by the validation door when `format: "chat"`.
- **`segmentSpeech(text)`** (`text/segment.ts`) cuts at real sentence ends only — guards for
  abbreviations (en/cs/de sets), decimals/times, initials, and the Czech ordinal dot
  (`7. dubna`), never inside an open quote/bracket; merges below 40 chars, force-splits above
  the engine's `capabilities.maxClipChars` (cloud 1200, local 300), and lets the *first* chunk
  stop at a clause mark to win time-to-first-audio.
- **Server**: above the engine cap, `speak()` segments and joins WAV clips itself, so a
  whole-clip caller still gets one clip. Measured: a 450-char Czech paragraph on Piper = 10 s
  synthesis for 58 s of audio — the number that makes pipelining mandatory.
- **Browser**: `useTts` normalizes + segments client-side, fetches chunk N+1 while N plays
  (lookahead 2), reports `served.firstAudioMs` and `progress {spoken,total}`; a mid-utterance
  failure is shown as a truncation ("stopped after 2 of 5, the rest is in the text").
- **Like-for-like compare**: ElevenLabs is requested as raw 24 kHz PCM and wrapped into WAV
  (`node/wav.ts`), so all three providers return `audio/wav`. Not yet: loudness normalization,
  leading-silence trim, showing the sample rate.
- **Kokoro languages** corrected to the eight the v1.0 pack speaks (en es fr hi it ja pt zh) —
  no Czech/German; a Czech sentence comes back in an English accent, not an error. Voices:
  `af_heart` (verified by ear), `am_michael`, `bf_emma` (derived from the pack's ordering).

## Providers shipped

| id | kind | Engine | Languages | Needs | Notes |
| --- | --- | --- | --- | --- | --- |
| `elevenlabs` | cloud | hosted TTS REST (`/v1/text-to-speech/{voice}`), PCM 24 kHz wrapped to WAV | any | `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` (default `eleven_flash_v2_5`), `ELEVENLABS_BASE_URL` | probe = `GET /v1/user`, cached 60 s; 401 → broken |
| `piper` | local | Piper ONNX via the `piper` CLI, text on stdin, WAV | en, cs (whatever voices are installed) | `piper` on PATH / `PIPER_BIN`; voices in `data/piper` (`PIPER_VOICE_DIR`) or `~/.personas/companion-tts/piper/*` | the only local Czech voice; a language hint picks the voice |
| `kokoro` | local | Kokoro through the `sherpa-onnx-offline-tts` sidecar, text as trailing arg, 24 kHz WAV | en es fr hi it ja pt zh (no cs/de) | sidecar + `kokoro-multi-lang-v1_0` in `~/.personas/companion-tts/{bin,kokoro}` (`KOKORO_BIN`, `KOKORO_MODEL_DIR`) | the same install the Personas desktop app makes — one download serves both apps; curated voice `af_heart` (sid 3), extend with `KOKORO_VOICES="id:sid,…"` |

Shared sidecar home: `VOICE_SIDECAR_HOME` overrides `~/.personas/companion-tts`. Binary
ladder: explicit env → shared home `bin/` → PATH.

## Host wrapper (`/api/tts`)

- `GET` → `{ providers: TtsStatus[], preferred, allowed }` — probes only, spends nothing.
- `POST { text, language?, provider?, voiceId?, speed? }` → audio bytes with
  `X-Tts-Provider`, `X-Tts-Voice`, `X-Tts-Elapsed-Ms`, `X-Tts-Fallback-From?`. `useTts` reads
  all four; `X-Tts-Voice` surfaces as `served.voiceId` (the voice that spoke is not always the
  one asked for — a null request takes the engine default and a fallback provider ignores the
  other engine's ids).
- Errors are typed, and the status is part of the contract:

  | `TtsError.code` | status | caller's next action |
  | --- | --- | --- |
  | `invalid_text`, `invalid_voice` | 400 | fix the request; never retry unchanged |
  | `unavailable` | 503 | nothing can speak (no key, no entitlement, nothing installed) |
  | `rate_limited` | 429 + `Retry-After` | wait, then retry the same request |
  | `timeout` | 504 | retry or shorten the text |
  | `engine_failed` | 502 | the engine broke; retry or fall back |

  ElevenLabs statuses map: 429 → `rate_limited` (`Retry-After` parsed as delta-seconds or
  HTTP-date; malformed/past → `undefined`, host picks its own backoff), 422/404 →
  `invalid_voice`, 401/403 → `unavailable`, 5xx → `engine_failed`. A 429 deliberately does
  NOT invalidate the cached ready probe — busy is not down.
- `requireOperator()` (defense in depth) and `rateLimit("tts:<ip>", 60/10 min)` — pinned by
  `app/api/rate-limit-contract.test.ts`, because in open mode a cloud call costs money and a
  local call spawns a process.
- Browser side: `packages/voice-tts/src/react/useTts.ts` owns playback (one utterance
  audible at a time, stop means now, blocked autoplay surfaces a play affordance).

### Metered, and never paid twice

- **Every serve writes one `llm_usage` row** — use case `tts`, the serving provider, the
  voice as `model`, and a `cost_usd` estimate from `app/_lib/tts-prices.ts` (USD per 1000
  characters; ElevenLabs 0.22, the two local engines a *known* zero, an unlisted provider
  `null` so it counts as `unpriced_calls` rather than as free). Token columns stay null:
  characters are not tokens. Same shape and the same reasoning as
  `app/_lib/voice/minute-prices.ts` on the realtime plane. The write is best-effort — the
  ledger is telemetry and never the request.
- **A bounded host-side cache** (`app/_lib/tts-cache.ts`) folds an identical repeat request
  into the clip the first one produced, so auto-speak followed by the play the operator
  presses after a blocked autoplay — or arrowing back to an answer and replaying it — is
  ONE synthesis. Key = requested provider + voice + language + speed + format + a sha256 of
  the whitespace-normalised text; anything that changes the bytes is in the key.
  **In-memory, process lifetime** (64 entries / 16 MB, LRU, single clips over 4 MB served
  but not stored): a restart is rare next to a replay, and the audit trail survives it
  anyway because the ledger row does. The response carries `X-Tts-Cache: hit|miss`; a hit
  is metered as a counted call that spent nothing (`source: "deterministic"`, cost 0).
  `Cache-Control: no-store` on the response is unchanged — the browser still stores nothing.

## Where it is applied in kp

- `/interview-lab` → **Compare voice providers** panel: every provider in
  `KP_TTS_PROVIDERS` (all, when unset), its probe state and setup hint, one sentence (en/cs)
  spoken by the picked provider, "spoken by X in N ms (fell back from Y)". Internal only —
  candidate surfaces never show a provider.
- The conversation plane now honors `KP_VOICE_PROVIDER` (`onboardedVoiceProvider` in
  `app/_lib/voice/index.ts`) between an explicit request and the canonical order.

## Keyless / engineless behavior

Nothing set: `GET /api/tts` lists three `absent` providers, each with the exact setup step;
`POST` answers 503 `unavailable`; the lab panel disables every button and prints the hints.
Nothing was served, so nothing is cached and **no ledger row is written** — a refusal is not
a call, and a zero-cost row for it would inflate the call count with calls that never were.
No other kp feature depends on spoken output, so the app is whole without it.

## Known gaps

- No streaming *adapter* yet (`capabilities.streaming` is false everywhere — pipelining is at
  the utterance level); local engines are spawned per call (Piper/sherpa both have resident
  modes — adopt when a host needs sub-second local first audio).
- No local Czech voice above Piper quality; no Czech number expansion.
- Preference lives in env, not Settings → the compare panel cannot persist a pick; that is
  the next step once a settings row for voice exists.
