# @kazm/voice-tts

Multi-provider text-to-speech you can drop into any Node/React app: one interface, cloud +
local adapters, honest probes, a host-bound preference, and a headless playback hook.
Source-only — copy or link this directory; no build step; nothing here imports the host.

```
src/
  types.ts          the contract: TtsProvider, TtsHost, TtsProbe, TtsPreference, TtsError
  validate.ts       the ONE validation door (text cap, voice-id allowlist, language, speed)
  registry.ts       createTts(): dispatch door, preference resolution, visible fallback
  node/             spawn + binary-ladder helpers shared by local adapters
  providers/        elevenlabs (cloud REST) · piper (local) · kokoro (local sherpa sidecar) · fake (tests)
  react/useTts.ts   browser hook: status, speak, stop, blocked-autoplay resume
```

## Bind it to your app (the host seam)

```ts
import os from "node:os";
import { createTts, preferenceFromEnv, type TtsHost } from "<path>/voice-tts/src/index.ts";

const host: TtsHost = {
  env: (k) => process.env[k],           // or your secrets vault
  homeDir: () => os.homedir(),
  cwd: () => process.cwd(),
  log: (e) => { if (e.type === "fallback" || e.type === "error") console.warn("[tts]", e); },
};
export const tts = createTts({
  host,
  preference: preferenceFromEnv(host, { preferred: "MYAPP_TTS_PROVIDER", allowed: "MYAPP_TTS_PROVIDERS" }),
});
```

The host names its own preference variables. `preferred` is what onboarding/settings wrote
down; `allowed` is the compare set the UI may expose (unset = every registered provider — a
local install; one id = locked — a team deploy). Unknown ids normalize away on read.

## Wrap it in a route (the host wrapper)

The package never owns auth, rate limiting or HTTP — those are the host's policy. The shape
that `useTts` expects:

- `GET <endpoint>` → `{ providers: TtsStatus[] }` (probe only; spends nothing)
- `POST <endpoint> { text, language?, provider?, voiceId?, speed? }` → audio bytes with
  headers `X-Tts-Provider`, `X-Tts-Voice`, `X-Tts-Elapsed-Ms`, and `X-Tts-Fallback-From` when
  the served provider is not the one asked for. `useTts` reads all four; `X-Tts-Voice`
  surfaces as `served.voiceId`, because the voice that spoke is not always the one asked for
  (a null request takes the engine default, and a fallback provider ignores the other
  engine's ids). `X-Tts-Unsupported-Language` rides along when NO ready engine declares the
  requested language: the clip is served in the engine's own accent rather than not at all,
  and that is a fact the surface should be able to show.
- Gate it (a cloud call costs money, a local call spawns a process) — rate-limit per caller.

### `TtsError.code` → HTTP (the mapping a host owes its callers)

| code | status | what the caller should do |
| --- | --- | --- |
| `invalid_text`, `invalid_voice` | 400 | fix the request — never retry it unchanged |
| `unavailable` | 503 | no engine can speak: credentials, entitlement or nothing installed |
| `rate_limited` | **429** + `Retry-After` | wait, then retry the SAME request |
| `timeout` | 504 | the engine took too long; retry or shorten the text |
| `aborted` | 499 / no body | the caller went away |
| `engine_failed` | 502 | the engine broke; retry or fall back |

`rate_limited` is the one that must not collapse into 502: the engine is healthy and the
same request succeeds later, so "add credits" (`unavailable`) and "wait a moment" are
different next actions. When the service sent a `Retry-After`, `TtsError.retryAfterMs`
carries it (delta-seconds or HTTP-date, both parsed; malformed or past values yield
`undefined` so the host picks its own backoff) — forward it:

```ts
if (err.code === "rate_limited") {
  const headers = err.retryAfterMs ? { "retry-after": String(Math.ceil(err.retryAfterMs / 1000)) } : undefined;
  return new Response(JSON.stringify({ error: "TTS_RATE_LIMITED" }), { status: 429, headers });
}
```

Reference realization: kp's `app/api/tts/route.ts` + `app/_lib/tts.ts`.

## Chat text and chunking

```ts
import { speechReady, segmentSpeech } from "<path>/voice-tts/src/index.ts";
speechReady("## Hi
We **shipped** it — see [the PR](https://x/1) 🎉");
// -> "Hi. We shipped it — see the PR."
segmentSpeech("Dr. Novák přijde 7. dubna v 14.30. Cena je 3.5 milionu Kč.");
// -> ["Dr. Novák přijde 7. dubna v 14.30.", "Cena je 3.5 milionu Kč."]
```

Pass `format: "chat"` to `speak()` and the validation door runs `speechReady` for you. Above
the engine's `capabilities.maxClipChars` the registry segments and joins WAV clips; `useTts`
does the same client-side and pipelines playback (chunk N plays while N+1 is fetched). Numbers
are deliberately not expanded — inflected languages need a per-locale normalizer you own.

## Use it in the browser

```tsx
const tts = useTts({ endpoint: "/api/tts" });
useEffect(() => { void tts.refreshProviders(); }, []);
<button onClick={() => tts.speak({ text, language: "cs", provider: picked })}>Speak</button>
{tts.playback === "blocked" && <button onClick={tts.resume}>Play</button>}
{tts.served?.fallbackFrom && <span>fell back from {tts.served.fallbackFrom}</span>}
```

Render provider choices from `tts.providers` (filter `allowed`), disable those whose
`probe.state !== "ready"`, and print `probe.reason` + `probe.setup` — absent (install
something) and broken (fix something) are different next actions.

## Rules the package keeps, and you should too

1. **Never branch on `id` in a surface.** Branch on `capabilities` (`onDevice`, `languages`,
   `speed`, `streaming`).
2. **Every request passes `validateRequest`.** Adapters assume a bounded, sanitized request.
3. **Probe the artifact, not the config.** Binary readable, `model.onnx` present, key accepted.
4. **Fallback is visible; nothing-ready is an error.** Never an empty 200. The DECLARED
   language is part of the pick: `resolve(requested, language)` skips a ready engine whose
   `capabilities.languages` excludes the requested primary tag while another ready engine
   declares it, and when none does it serves anyway with `unsupportedLanguage` set plus a
   `language_fallback` log event. Kokoro declares no `cs`/`de`, and a Czech operator used to
   be read to in English with nothing to show for it.
5. **Local engines share one per-user home** (`~/.personas/companion-tts`, override
   `VOICE_SIDECAR_HOME`) so one model download serves every app on the machine.
6. **Adding a provider** = one literal in `TTS_PROVIDER_IDS` + one adapter file + a row in
   `defaultProviders`. Nothing else.

## Providers

| id | kind | needs | output |
| --- | --- | --- | --- |
| `elevenlabs` | cloud | `ELEVENLABS_API_KEY` (+ `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_BASE_URL`) | WAV 24 kHz (PCM requested, wrapped here for like-for-like compare) |
| `piper` | local | `piper` binary (`PIPER_BIN`), voices dir (`PIPER_VOICE_DIR`, default `<cwd>/data/piper`, plus `<home>/piper/*`) | WAV |
| `kokoro` | local | `sherpa-onnx-offline-tts` (`KOKORO_BIN`) + `kokoro-multi-lang-v1_0` dir (`KOKORO_MODEL_DIR`, default `<home>/kokoro`); extra voices `KOKORO_VOICES="id:sid,…"` | WAV 24 kHz |

## Tests

`registry.test.ts`, `text.test.ts` and `providers/elevenlabs.test.ts` run on Node's built-in
runner: validation door, preference parsing, resolution order, visible fallback, allowed-set
enforcement, unavailable-with-reason, status enumeration; the segment-and-join path (a
`FakeTts` with `maxClipChars: 50` fed 200 chars — one joined WAV, one header, data = the sum
of the parts); local serialization and cloud non-serialization as an observable ORDER; and
the cloud adapter's full status→code table against a `fetch` double. No audio, no network, no
model files.

`FakeTts` takes `capabilities` (override `maxClipChars` and the segmentation path becomes
reachable without a 1200-char fixture), `gate` (suspend `synthesize` until the test releases
it) and `trace` (a shared `start:/end:` log, so overlap is an order rather than a timing
guess).

Not covered here, and only a live key can: that the hosted service actually answers 422 for a
bad voice and 429 with a `Retry-After` — the table pins OUR mapping, not their statuses.
