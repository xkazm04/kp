// The host wrapper around the portable STT package (docs/architecture/voice-stt-package.md).
//   GET  /api/stt  -> { providers: SttStatus[], preferred, allowed }   (probe, no transcription)
//   POST /api/stt  multipart: audio=<File>, language?, provider?, model?,
//                  diarize?, redact?, onDevice? -> a transcript as JSON
//
// The route owns everything the package deliberately refuses to own: the
// operator gate (defense in depth — the proxy already gates in team mode), the
// per-IP throttle, the upload contract, and the typed-error-to-status mapping.
//
// Why the throttle is tighter than /api/tts's: a synthesis call is one short
// clip, while one call here is billed per audio HOUR on the cloud path and
// occupies a CPU for minutes on the local one. 20 per 10 minutes is well past
// any human reviewing interviews by hand and nowhere near a bill worth noticing.
import { NextResponse } from "next/server";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { validateAudioUploadServer } from "@/app/_lib/upload-constraints";
import { getStt, isSttMimeType, SttError, type SttNeeds } from "@/app/_lib/stt";

const STT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// The engine's typed code -> the status. A LOOKUP rather than a ternary chain
// over the union, for the reason /api/tts's twin states: the package owns the
// union and grows it, and a route that cannot compile against a member it has
// not heard of breaks on a bump instead of degrading to the honest 502.
// `unsupported` keeps its own 422: the request was well-formed and the engines
// are healthy, but what was asked for (redaction, diarization, on-device) is not
// on offer here. `too_long` is a 413 beside the byte cap, because the clip is
// well-formed and the remedy for both is the same one: split it.
const STT_ERROR_STATUS: Record<string, number> = {
  invalid_audio: 400,
  invalid_language: 400,
  invalid_model: 400,
  unsupported: 422,
  unavailable: 503,
  timeout: 504,
};

/** The ENGINE's own 429, answered with our own throttle's code so a client that
 *  can back off from one can back off from both. Our per-IP refusal above calls
 *  `jsonRefusal` inline rather than coming through here: the limiter's call site
 *  and its refusal are pinned as a pair by rate-limit-contract.test.ts, and a
 *  helper in between is exactly the indirection that pin exists to prevent.
 *  429 with the wait the engine ASKED for, and no header when it did not say —
 *  a fabricated Retry-After is worse than none. Same shape as /api/tts's. */
function engineThrottled(retryAfterMs?: number) {
  const res = jsonRefusal("TOO_MANY_REQUESTS", 429);
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    res.headers.set("retry-after", String(Math.ceil(retryAfterMs / 1000)));
  }
  return res;
}

/** Form fields arrive as strings; only an explicit "true"/"1" is a yes. */
function flag(form: FormData, name: string): boolean {
  const v = form.get(name);
  return v === "true" || v === "1";
}

function str(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function GET() {
  const denied = await requireOperator();
  if (denied) return denied;
  const stt = getStt();
  const providers = await stt.status();
  return NextResponse.json({ providers, preferred: stt.preference.preferred, allowed: stt.preference.allowed });
}

export async function POST(request: Request) {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`stt:${clientIpFrom(request.headers)}`, STT_RATE_LIMIT)) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonRefusal("AUDIO_MISSING", 400);
  }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return jsonRefusal("AUDIO_MISSING", 400);
  }
  const rejection = validateAudioUploadServer(file);
  if (rejection) return jsonRefusal(rejection.code, rejection.status);
  // The gate accepted the type, so the package's door will too — but the door is
  // the authority, and narrowing here rather than casting keeps it that way.
  const mimeType = file.type;
  if (!isSttMimeType(mimeType)) {
    return jsonRefusal("AUDIO_UNSUPPORTED_TYPE", 400);
  }

  // `onDevice` is a per-request FLOOR, never a widening: it can refuse the cloud
  // for one sensitive clip on a deploy that allows both, and it cannot admit a
  // provider KP_STT_PROVIDERS excludes.
  const needs: SttNeeds = flag(form, "onDevice") ? { onDevice: true } : {};

  try {
    const out = await getStt().transcribe(
      {
        audio: new Uint8Array(await file.arrayBuffer()),
        mimeType,
        language: str(form, "language"),
        modelId: str(form, "model"),
        diarize: flag(form, "diarize"),
        redactPii: flag(form, "redact"),
      },
      { provider: str(form, "provider"), needs, signal: request.signal },
    );
    return NextResponse.json(
      {
        text: out.text,
        segments: out.segments,
        language: out.language,
        provider: out.provider,
        modelId: out.modelId,
        elapsedMs: out.elapsedMs,
        durationMs: out.durationMs,
        // What the engine DID. A surface that prints "redacted" reads this, not
        // the checkbox that was ticked.
        diarized: out.diarized,
        redacted: out.redacted,
        fallbackFrom: out.fallbackFrom,
      },
      {
        headers: {
          "cache-control": "no-store",
          "x-stt-provider": out.provider,
          "x-stt-elapsed-ms": String(out.elapsedMs),
          ...(out.fallbackFrom ? { "x-stt-fallback-from": out.fallbackFrom } : {}),
        },
      },
    );
  } catch (err) {
    if (err instanceof SttError) {
      // The engine asking us to slow down is the SAME refusal as our own
      // throttle, so it answers with the same code and the same header.
      if (err.code === "rate_limited") return engineThrottled(err.retryAfterMs);
      // A clip past the engine's declared length ceiling is a REFUSAL the
      // operator can act on, so it carries a resolvable code rather than the
      // adapter's English: "split it and try again", in their own language.
      if (err.code === "too_long") return jsonRefusal("STT_TOO_LONG", 413);
      // The twin of /api/tts's engine branch, and for the same reason: the
      // adapter's English ("OPENAI_API_KEY is not set", a whisper.cpp stderr
      // tail) is a server-log fact, never a response body. The chokepoint logs
      // it under `api:stt:engine` and answers STT_FAILED at the engine's own
      // status. `provider` left the body with the message; nothing read it.
      return safeJsonError(err, "api:stt:engine", "STT_FAILED", STT_ERROR_STATUS[err.code] ?? 502);
    }
    return safeJsonError(err, "api:stt", "STT_FAILED");
  }
}
