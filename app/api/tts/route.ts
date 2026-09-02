// The host wrapper around the portable TTS package (docs/architecture/voice-tts-package.md).
//   GET  /api/tts  -> { providers: TtsStatus[], preferred, allowed }   (probe, no audio)
//   POST /api/tts  { text, language?, provider?, voiceId?, speed? } -> audio bytes
// Operator-gated (defense in depth — the proxy already gates in team mode) and
// per-IP rate-limited: a cloud call costs money and a local call spawns a
// sidecar. The served provider travels in headers so the browser can show
// "spoken by X (fell back from Y)" — fallback is visible, never silent.
import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { getTts, TtsError } from "@/app/_lib/tts";
import { speakCached } from "@/app/_lib/tts-cache";
import { ttsUsageRow } from "@/app/_lib/tts-prices";
import { insertLlmUsage } from "@/app/_lib/db/llm";

const TTS_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };

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
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }
  let body: { text?: unknown; language?: unknown; provider?: unknown; voiceId?: unknown; speed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
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
      const status = err.code === "invalid_text" || err.code === "invalid_voice" ? 400 : err.code === "unavailable" ? 503 : err.code === "timeout" ? 504 : 502;
      return NextResponse.json({ error: err.message, code: err.code, provider: err.provider ?? null }, { status });
    }
    console.error("[tts] unexpected", err);
    return NextResponse.json({ error: "synthesis failed" }, { status: 500 });
  }
}
