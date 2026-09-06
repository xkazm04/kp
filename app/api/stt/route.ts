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
import { sttUsageRow } from "@/app/_lib/stt-prices";
import { insertLlmUsage } from "@/app/_lib/db/llm";

const STT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

// A transcription is minutes of work, not milliseconds, and both adapters budget
// 300 s of their own (assemblyai.ts JOB_TIMEOUT_MS, whisper-cpp.ts
// DEFAULT_TIMEOUT_MS). Declaring nothing here left the platform's default (a few
// seconds on some hosts) to kill the handler mid-call, and a killed handler is
// exactly the failure that leaves no trace: the local sidecar keeps running with
// no parent, its scratch dir is never removed, and the caller gets a platform
// error page rather than one of this route's coded refusals.
//
// The pair is the same one app/api/extract-text/route.ts uses, and it is a pair
// on purpose: the engine budget is DERIVED from maxDuration so the two cannot
// drift into the arrangement where the platform kills the function while the
// adapter still believes it has time. The 10 s of headroom is for the abort to
// propagate, the sidecar to be reaped and its scratch dir to be removed inside
// the budget. Read `.claude/CLAUDE.md`: maxDuration is SERVERLESS-only, so on a
// self-hosted `next start` nothing enforces it and STT_ENGINE_TIMEOUT_MS is the
// real bound on both paths. That is the reason it is passed to the engine rather
// than merely declared.
export const maxDuration = 300;
const STT_ENGINE_TIMEOUT_MS = (maxDuration - 10) * 1000;

// The engine's typed code -> the status. A LOOKUP rather than a ternary chain
// over the union, for the reason /api/tts's twin states: the package owns the
// union and grows it, and a route that cannot compile against a member it has
// not heard of breaks on a bump instead of degrading to the honest 502.
// `unsupported` keeps its own 422: the request was well-formed and the engines
// are healthy, but what was asked for (redaction, diarization, on-device) is not
// on offer here. `too_long` is a 413 beside the byte cap, because the clip is
// well-formed and the remedy for both is the same one: split it.
//
// `rate_limited`, `too_long` and `unavailable` are NOT here: each is answered as
// a refusal below, before this lookup is consulted, so a row for any of them
// would be a status nothing can select — and a dead row is drift waiting to
// happen (this table carried `unavailable: 503` for a day after the refusal
// landed, and the route test pinned the dead row rather than the live answer).
const STT_ERROR_STATUS: Record<string, number> = {
  invalid_audio: 400,
  invalid_language: 400,
  invalid_model: 400,
  unsupported: 422,
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
  // Each row now carries the engine models that install can actually serve
  // (SttStatus.models), so a picker offering "whisper_cpp / ggml-base.bin"
  // renders from this one probe instead of a second round trip per provider.
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
      { provider: str(form, "provider"), needs, signal: request.signal, timeoutMs: STT_ENGINE_TIMEOUT_MS },
    );
    // Every transcript is metered, local ones included: the cloud path is billed
    // per audio HOUR and the on-device path is a known zero, and both belong in
    // the ledger so the Models usage panel and the billing spend fold can show
    // what the input plane costs instead of leaving it off every total. Priced
    // on `durationMs` (what a vendor bills for), never on `elapsedMs` (how long
    // the engine took). Best-effort, in the house shape: the ledger is
    // telemetry and never the request.
    try {
      insertLlmUsage(sttUsageRow({ provider: out.provider, modelId: out.modelId, durationMs: out.durationMs }));
    } catch (ledgerErr) {
      console.warn("[stt] ledger write failed", ledgerErr);
    }
    return NextResponse.json(
      {
        text: out.text,
        segments: out.segments,
        language: out.language,
        provider: out.provider,
        modelId: out.modelId,
        elapsedMs: out.elapsedMs,
        durationMs: out.durationMs,
        // What was ASKED for, beside what served. `fallbackFrom` alone cannot
        // say it: a provider outside KP_STT_PROVIDERS is dropped before the
        // resolution order is built, so a residency-locked deploy answered a
        // request for the cloud engine with the local one and reported no
        // fallback at all. A surface with a provider picker has to be able to
        // tell the operator their pick was overruled.
        requestedProvider: out.requestedProvider,
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
      // "Nothing here can listen" is a CONFIGURATION fact the operator can act
      // on, and the probe reason that carries it names an env var or a model
      // path — a server-log fact, never a response body. So it answers its own
      // resolvable code rather than STT_FAILED's "please try again", which a
      // keyless install cannot do anything with. It never reaches
      // STT_ERROR_STATUS, which is why that table has no `unavailable` row.
      if (err.code === "unavailable") return jsonRefusal("STT_UNAVAILABLE", 503);
      // THE CALLER WENT AWAY. Not a fault, so it must not travel the engine
      // branch: that logs under `api:stt:engine`, and a page navigation or a
      // cancelled upload would fill an operator's log with engine faults that
      // no engine committed, teaching them to ignore the one line that matters.
      // 499 (nginx's "client closed request") rather than a coded body: the
      // socket the body would be written to is the one that just closed, so
      // there is no reader to localize a code for, and an empty response is the
      // only honest thing to say to somebody who stopped listening.
      if (err.code === "aborted") return new NextResponse(null, { status: 499 });
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
