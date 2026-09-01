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
import { clientIpFrom, rateLimit, RATE_LIMITED_ERROR } from "@/app/_lib/rate-limit";
import { validateAudioUploadServer } from "@/app/_lib/upload-constraints";
import { getStt, isSttMimeType, SttError, type SttNeeds } from "@/app/_lib/stt";

const STT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

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
    return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected a multipart body with an `audio` file" }, { status: 400 });
  }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "`audio` must be a non-empty file" }, { status: 400 });
  }
  const rejection = validateAudioUploadServer(file, "recording");
  if (rejection) return NextResponse.json({ error: rejection.error }, { status: rejection.status });
  // The gate accepted the type, so the package's door will too — but the door is
  // the authority, and narrowing here rather than casting keeps it that way.
  const mimeType = file.type;
  if (!isSttMimeType(mimeType)) {
    return NextResponse.json({ error: `unsupported container ${mimeType}` }, { status: 400 });
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
      // Five different answers, mapped in exactly one place so the browser can
      // branch without parsing messages. `unsupported` is its own 422: the
      // request was well-formed and the engines are healthy — what was asked for
      // (redaction, diarization, on-device) is not on offer here.
      const status =
        err.code === "invalid_audio" || err.code === "invalid_language" || err.code === "invalid_model"
          ? 400
          : err.code === "unsupported"
            ? 422
            : err.code === "unavailable"
              ? 503
              : err.code === "timeout"
                ? 504
                : 502;
      return NextResponse.json({ error: err.message, code: err.code, provider: err.provider ?? null }, { status });
    }
    console.error("[stt] unexpected", err);
    return NextResponse.json({ error: "transcription failed" }, { status: 500 });
  }
}
