// The host wrapper around the portable TTS package (docs/architecture/voice-tts-package.md).
//   GET  /api/tts  -> { providers: TtsStatus[], preferred, allowed }   (probe, no audio)
//   POST /api/tts  { text, language?, provider?, voiceId?, speed? } -> audio bytes
// Operator-gated (defense in depth — the proxy already gates in team mode) and
// per-IP rate-limited: a cloud call costs money and a local call spawns a
// sidecar. The served provider travels in headers so the browser can show
// "spoken by X (fell back from Y)" — fallback is visible, never silent.
import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { getTts, TtsError } from "@/app/_lib/tts";
import { speakCached } from "@/app/_lib/tts-cache";
import { ttsUsageRow } from "@/app/_lib/tts-prices";
import { insertLlmUsage } from "@/app/_lib/db/llm";

const TTS_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

// The engine's typed code -> the status that tells the caller what to do next.
// A LOOKUP rather than a ternary chain over the union: the package owns that
// union and adds to it (`rate_limited` arrived after this route was written), so
// a shape that cannot compile against an unknown member is a route that breaks
// on a package bump instead of degrading to the honest default. Anything not
// listed is 502 — the engine broke, and that is what a caller retries against.
const TTS_ERROR_STATUS: Record<string, number> = {
  invalid_text: 400,
  invalid_voice: 400,
  unavailable: 503,
  timeout: 504,
};

/** The ENGINE's own 429, answered with our own throttle's code so a client that
 *  can back off from one can back off from both. Our per-IP refusal above calls
 *  `jsonRefusal` inline rather than coming through here: the limiter's call site
 *  and its refusal are pinned as a pair by rate-limit-contract.test.ts, and a
 *  helper in between is exactly the indirection that pin exists to prevent.
 *  429 with the wait the engine ASKED for, and no header at all when it did not
 *  say. A fabricated Retry-After is worse than none: a client that trusts it
 *  either hammers a service that wanted longer or sleeps through a window that
 *  was already open. */
function engineThrottled(retryAfterMs?: number) {
  const res = jsonRefusal("TOO_MANY_REQUESTS", 429);
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    res.headers.set("retry-after", String(Math.ceil(retryAfterMs / 1000)));
  }
  return res;
}

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  const tts = getTts();
  const providers = await tts.status();
  return NextResponse.json({ providers, preferred: tts.preference.preferred, allowed: tts.preference.allowed });
}

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`tts:${clientIpFrom(request.headers)}`, TTS_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  let body: { text?: unknown; language?: unknown; provider?: unknown; voiceId?: unknown; speed?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonRefusal("VOICE_REQUEST_INVALID", 400);
  }
  const text = typeof body.text === "string" ? body.text : "";
  try {
    // speakCached folds an identical repeat request into the clip the first one
    // produced (app/_lib/tts-cache.ts): auto-speak followed by the play the
    // operator presses when the browser blocked autoplay used to pay twice.
    const { audio, cached, key } = await speakCached(
      getTts(),
      {
        text,
        language: typeof body.language === "string" ? body.language : null,
        voiceId: typeof body.voiceId === "string" ? body.voiceId : null,
        speed: typeof body.speed === "number" ? body.speed : null,
      },
      { provider: body.provider, signal: request.signal },
    );
    // Every serve is metered, hits included — a hit is a counted call that spent
    // nothing (source "deterministic", cost 0), so the ledger shows both what
    // was spent and what the cache saved. Best-effort, in the house shape: the
    // ledger is telemetry and never the request.
    try {
      insertLlmUsage(ttsUsageRow({ provider: audio.provider, voiceId: audio.voiceId, chars: text.length, cached, requestId: key }));
    } catch (ledgerErr) {
      console.warn("[tts] ledger write failed", ledgerErr);
    }
    return new NextResponse(audio.bytes as BodyInit, {
      status: 200,
      headers: {
        "content-type": audio.mimeType,
        // The BROWSER still stores nothing: the audio is short-lived, may carry
        // a candidate's name, and the host-side cache is where the saving is.
        "cache-control": "no-store",
        "x-tts-provider": audio.provider,
        "x-tts-voice": audio.voiceId,
        "x-tts-elapsed-ms": String(audio.elapsedMs),
        "x-tts-cache": cached ? "hit" : "miss",
        ...(audio.fallbackFrom ? { "x-tts-fallback-from": audio.fallbackFrom } : {}),
      },
    });
  } catch (err) {
    if (err instanceof TtsError) {
      // The engine asking us to slow down is the SAME refusal as our own
      // throttle, so it answers with the same code and the same header — a
      // client that can back off from one can back off from both.
      if (err.code === "rate_limited") return engineThrottled(err.retryAfterMs);
      // THE ENGINE'S SENTENCE IS A SERVER-LOG FACT. It used to travel as `error`
      // — "ELEVENLABS_API_KEY is not set", a provider's English 502 body, a
      // sidecar's stderr — and the client renders `error`, so a keyless install
      // printed an env var name in the Play button's tooltip of a Czech UI. The
      // chokepoint logs the whole error under `api:tts:engine` and answers the
      // registry sentence plus TTS_FAILED, which every locale has; the engine's
      // own status is kept, because 503-vs-504-vs-502 is what a caller retries
      // against. `provider` left the body with the message: nothing read it, and
      // the served provider already travels in a header on the success path.
      // "Nothing can speak here" is a DECISION, not an accident: no key, no
      // entitlement, nothing installed. Its sentence IS the information, so it
      // answers through jsonRefusal with its own code — and takes its status
      // from the same lookup as every other engine code, so 503 is written once.
      if (err.code === "unavailable") return jsonRefusal("TTS_UNAVAILABLE", TTS_ERROR_STATUS.unavailable);
      return safeJsonError(err, "api:tts:engine", "TTS_FAILED", TTS_ERROR_STATUS[err.code] ?? 502);
    }
    return safeJsonError(err, "api:tts", "TTS_FAILED");
  }
}
