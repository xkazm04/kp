# Spoken output — the portable multi-provider TTS package

Status: shipped 2026-08-23. Package at [`packages/voice-tts`](../../packages/voice-tts/README.md),
bound into kp by `app/_lib/tts.ts`, served by `app/api/tts/route.ts`, compared by ear in
`app/_components/voice/TtsComparePanel.tsx` on `/interview-lab`. The cross-app standard
lives in the ai-registry (`voice-io` → technique `portable-provider-package`); this page is
kp's realization of it.

## Two voice planes, one preference story

kp speaks in two different ways, and they are deliberately separate registries:

| Plane | What it is | Registry | Preference var |
| --- | --- | --- | --- |
| **Conversation** | a live duplex session: the provider listens, (sometimes) decides, and speaks — OpenAI Realtime, ElevenLabs Agents, or a self-hosted Agents-protocol server | `app/_lib/voice/` (`VoiceAdapter`) | `KP_VOICE_PROVIDER` (openai \| elevenlabs), honored by `pickDefaultProvider` only when that provider is configured |
| **Spoken output** | text → one audio clip, no listening | `packages/voice-tts` (`TtsProvider`) | `KP_TTS_PROVIDER` (preferred) + `KP_TTS_PROVIDERS` (compare set) |

The onboarding skill (`/onboarding voice`) asks both questions and writes both vars. They
are not merged on purpose: a conversation provider owns turn-taking and barge-in and is
priced per minute; a TTS provider owns one utterance and is priced per character or runs
free on-device. The registry's `duplex-agent-sessions` technique governs the first, the
TTS package the second. The relay-mode path (`docs/architecture/voice-conversation-plane.md`)
is where the two will meet: a transport-only conversation provider's `speak(text)` can be
served by this package once a streaming local engine is worth it.

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
- **The test seam is the interface.** `providers/fake.ts` scripts probe outcomes and
  failures; `registry.test.ts` covers the door, the resolution order, visible fallback and
  the unavailable path with no audio hardware or network.

## Providers shipped

| id | kind | Engine | Languages | Needs | Notes |
| --- | --- | --- | --- | --- | --- |
| `elevenlabs` | cloud | hosted TTS REST (`/v1/text-to-speech/{voice}`), MP3 | any | `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` (default `eleven_flash_v2_5`), `ELEVENLABS_BASE_URL` | probe = `GET /v1/user`, cached 60 s; 401 → broken |
| `piper` | local | Piper ONNX via the `piper` CLI, text on stdin, WAV | en, cs (whatever voices are installed) | `piper` on PATH / `PIPER_BIN`; voices in `data/piper` (`PIPER_VOICE_DIR`) or `~/.personas/companion-tts/piper/*` | the only local Czech voice; a language hint picks the voice |
| `kokoro` | local | Kokoro through the `sherpa-onnx-offline-tts` sidecar, text as trailing arg, 24 kHz WAV | en | sidecar + `kokoro-multi-lang-v1_0` in `~/.personas/companion-tts/{bin,kokoro}` (`KOKORO_BIN`, `KOKORO_MODEL_DIR`) | the same install the Personas desktop app makes — one download serves both apps; curated voice `af_heart` (sid 3), extend with `KOKORO_VOICES="id:sid,…"` |

Shared sidecar home: `VOICE_SIDECAR_HOME` overrides `~/.personas/companion-tts`. Binary
ladder: explicit env → shared home `bin/` → PATH.

## Host wrapper (`/api/tts`)

- `GET` → `{ providers: TtsStatus[], preferred, allowed }` — probes only, spends nothing.
- `POST { text, language?, provider?, voiceId?, speed? }` → audio bytes with
  `X-Tts-Provider`, `X-Tts-Voice`, `X-Tts-Elapsed-Ms`, `X-Tts-Fallback-From?`.
- Errors are typed: 400 invalid text/voice, 503 unavailable, 504 timeout, 502 engine failed.
- `requireOperator()` (defense in depth) and `rateLimit("tts:<ip>", 60/10 min)` — pinned by
  `app/api/rate-limit-contract.test.ts`, because in open mode a cloud call costs money and a
  local call spawns a process.
- Browser side: `packages/voice-tts/src/react/useTts.ts` owns playback (one utterance
  audible at a time, stop means now, blocked autoplay surfaces a play affordance).

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
No other kp feature depends on spoken output, so the app is whole without it.

## Known gaps

- No streaming adapter yet (`capabilities.streaming` is false everywhere); the relay-mode
  conversation plane keeps using the provider's own TTS until one exists.
- Kokoro ships one curated English voice; no local Czech voice above Piper quality.
- Preference lives in env, not Settings → the compare panel cannot persist a pick; that is
  the next step once a settings row for voice exists.
