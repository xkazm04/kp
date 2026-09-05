# @kazm/voice-stt

Multi-provider speech-to-text you can drop into any Node app: one interface, cloud +
on-device adapters, honest probes, a host-bound preference, and **capability-gated
resolution**. Source-only — copy or link this directory; no build step; nothing here imports
the host.

The sibling of [`@kazm/voice-tts`](../voice-tts/README.md), deliberately not a merge of it.
The seam, the probe states and the preference story are identical; everything called out
below is the part that had to differ, because this direction carries **a person's voice**
rather than the product's own words.

```
src/
  types.ts          the contract: SttProvider, SttHost, SttProbe, SttNeeds, SttPreference, SttError
  validate.ts       the ONE validation door (byte cap, container allowlist, language shape, model-id charset)
  registry.ts       createStt(): dispatch door, capability gate, preference resolution, visible fallback
  node/             binary ladder · subprocess plumbing · a header-only WAV reader (no decoder, on purpose)
  providers/        assemblyai (cloud async) · whisper-cpp (on-device) · fake (tests)
```

## Bind it to your app (the host seam)

```ts
import os from "node:os";
import { createStt, preferenceFromEnv, type SttHost } from "<path>/voice-stt/src/index.ts";

const host: SttHost = {
  env: (k) => process.env[k],           // or your secrets vault
  homeDir: () => os.homedir(),
  cwd: () => process.cwd(),
  // Lengths and timings only — never the transcript, never the audio.
  log: (e) => { if (e.type === "fallback" || e.type === "error") console.warn("[stt]", e); },
};
export const stt = createStt({
  host,
  preference: preferenceFromEnv(host, { preferred: "MYAPP_STT_PROVIDER", allowed: "MYAPP_STT_PROVIDERS" }),
});
```

Same four-member seam as the synthesis package, so one app binds both with one object.
`preferred` is what onboarding/settings wrote down; `allowed` is the compare set the UI may
expose — and here it is also the **residency control**: one on-device id means the audio
cannot leave the machine, and no per-request field can widen it.

## The capability gate — the one thing that is not a copy

```ts
await stt.transcribe({ audio, mimeType: "audio/wav", redactPii: true });
```

Synthesis can fall back from a fast voice to a slow one and the user hears the same words in
a different voice. Transcription **cannot** fall back from a redacting engine to a
non-redacting one: the words themselves change, and the ones that appear are exactly the
ones somebody asked to have removed. So an engine that cannot meet the need is not in the
resolution order at all:

```ts
type SttNeeds = { diarization?: boolean; redaction?: boolean; onDevice?: boolean };
await stt.resolve(undefined, { onDevice: true });   // refuses the cloud even when it is ready
```

When nothing allowed can meet the need, the package throws `SttError("unsupported")` naming
the missing capability — never a success carrying the un-redacted transcript. And
`transcript.redacted` / `.diarized` report **what the engine did**, read back off its answer,
never echoed from the request: the cloud adapter reads `redacted` from the vendor row's
accepted job configuration, and a row that says redaction was *not* applied to a request
that asked for it is an `unsupported` refusal rather than a transcript with a `false` flag
somebody might not read.

Length is gated the same way, before the engine is paid: every adapter declares
`capabilities.maxClipSeconds`, and the dispatch door reads the real duration out of a WAV
header (`node/wav.ts`, no decoder) and refuses a clip past the ceiling with
`SttError("too_long")` — no subprocess, no audio-hour. Compressed containers keep their
length behind a decoder this package deliberately does not carry, so for those the engine's
own limit is still the first thing that says no.

## Wrap it in a route (the host wrapper)

The package never owns auth, rate limiting, upload contracts or HTTP — those are the host's
policy. The shape:

- `GET <endpoint>` → `{ providers: SttStatus[] }` (probe only; spends nothing)
- `POST <endpoint>` multipart `audio=<File>` + `language? provider? model? diarize? redact?
  onDevice?` → a transcript as JSON, with `X-Stt-Provider`, `X-Stt-Elapsed-Ms`, and
  `X-Stt-Fallback-From` when the served engine is not the one asked for.
- Map `SttError.code` → status: `invalid_*` 400, **`too_long` 413**, **`unsupported` 422**,
  **`rate_limited` 429 + a `Retry-After` header from `err.retryAfterMs`**, **`unavailable` 503
  as a REFUSAL** (the probe's reason names an env var or a model path, so it is a server-log
  fact and the body carries a resolvable code instead), `timeout` 504, else 502 with the
  adapter's sentence logged, never returned. A caller's own abort (`aborted`) is NOT a
  failure: answer 499 with an empty body and log nothing, or every navigation away writes an
  engine fault no engine committed. `too_long` is 413 rather than 400 so a client branches on length
  the same way it branches on size — the upload gate already answers 413 for too many bytes,
  and "too much audio" is the same conversation.
- Give it a DEADLINE and pass it down. Both adapters budget 300 s of their own; a host that
  will be killed sooner (a serverless `maxDuration`, a proxy read timeout) must say so
  through `transcribe`'s optional `timeoutMs`, which every adapter takes the MINIMUM of
  against its own ceiling. A call killed from outside leaves an orphaned sidecar and an
  un-swept scratch dir; one the adapter times out itself is reaped.
- Gate it hard. One call is billed per audio **hour** on the cloud path and occupies a CPU
  for minutes on the local one — a looser throttle than a synthesis route, not a tighter one,
  is the mistake to avoid.

Reference realization: kp's `app/api/stt/route.ts` + `app/_lib/stt.ts`.

## Audio in, and what this package refuses to do

`validateRequest` admits `wav · x-wav · mpeg · mp4 · webm · ogg · flac` up to 25 MB. Past
that door, **no transcoding happens**: `node/wav.ts` reads a RIFF header (walking the chunk
list, so an injected `LIST` chunk does not mis-size the clip) and nothing else. A package
that quietly resamples has taken on a dependency, a failure mode and a CPU budget the host
never agreed to — so whisper.cpp, which reads 16 kHz PCM WAV and nothing else, returns a
typed refusal naming the fix:

```
invalid_audio: whisper.cpp needs 16 kHz PCM WAV; this clip is 44100 Hz format 1.
```

Resample in the host, where the dependency is a choice somebody made on purpose.

## Rules the package keeps, and you should too

1. **Never branch on `id` in a surface.** Branch on `capabilities` (`onDevice`, `languages`,
   `diarization`, `redaction`).
2. **Every request passes `validateRequest`.** Adapters assume a bounded, sanitized request.
3. **Probe the artifact, not the config.** Binary readable, `ggml-*.bin` present and not
   truncated, key accepted. Three states: absent (offer setup) ≠ broken (offer repair) ≠ ready.
4. **Throttling is not a fault.** A 429 is `rate_limited` carrying `retryAfterMs` parsed
   from the engine's own `Retry-After`, never `engine_failed` — the two have opposite next
   actions, and a cached positive probe survives a 429 (busy ≠ down).
5. **Fallback is visible; nothing-ready is an error.** Never an empty 200 — an empty
   transcript reads as silence, which is a claim about what the person said.
6. **A capability asked for and not delivered is a refusal**, not a quiet downgrade.
7. **Local engines share one per-user home** (`~/.personas/companion-tts`, override
   `VOICE_SIDECAR_HOME`) — the same one the TTS package uses, so a machine has one folder of
   voice engines and one download serves every app.
8. **Adding a provider** = one literal in `STT_PROVIDER_IDS` + one adapter file + a row in
   `defaultProviders`. Nothing else. Registration order is the default resolution order, so
   put on-device engines first.

## Providers

| id | kind | needs | notes |
| --- | --- | --- | --- |
| `whisper_cpp` | local | `whisper-cli` (or the pre-rename `main`) via `WHISPER_BIN` / `<sidecar home>/bin`; a `ggml-*.bin` in `WHISPER_MODEL_DIR` (default `<cwd>/data/whisper`) or `<sidecar home>/whisper` | multilingual incl. Czech; 16 kHz PCM WAV only; no diarization/redaction; `WHISPER_THREADS`, `WHISPER_TIMEOUT_MS` |
| `assemblyai` | cloud | `ASSEMBLYAI_API_KEY` (+ `ASSEMBLYAI_BASE_URL` for the EU data zone, `ASSEMBLYAI_MODEL`, `ASSEMBLYAI_PII_POLICIES`, `ASSEMBLYAI_PII_SUB`) | async upload→submit→poll; diarization + PII redaction; billed per audio hour; never self-retries a submission; the language hint is narrowed to its primary subtag (the vendor takes `cs`/`de` and `en_us`-style variants, not `cs-CZ`) |

## Tests

`registry.test.ts` runs on Node's built-in runner with the `FakeStt` provider: the
validation door, preference parsing (including on-device-first defaults), resolution order,
the capability gate in both directions (including the language gate running BEFORE any
probe), visible fallback, both shapes of "nothing can serve", the per-provider byte and clip
ceilings, status enumeration, and the WAV reader. `providers/adapters.test.ts` covers the
adapters themselves on doubles — a scripted `fetch` for the cloud path (`redacted` read off
the row, a 429 becoming `rate_limited` with its `Retry-After`, the primary-tag narrowing)
and a counting host for the local probe cache. No audio, no network, no model files.

Two things only a live check can confirm, and neither is asserted here: that AssemblyAI
accepts each `DEFAULT_PII_POLICIES` name (a rejected one comes back as its 400 body), and
that a real `whisper-cli` build produces the `-oj` document this adapter narrows.
