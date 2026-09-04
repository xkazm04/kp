// Client-side Sentry reporting — DSN-gated, following the repo's LightTrack
// precedent (pipeline/jobfit/llm/monitor.py activates only when LIGHTTRACK_URL
// is set): with NEXT_PUBLIC_SENTRY_DSN unset the SDK chunk is never even
// fetched, so the default local-first deploy ships zero telemetry code paths.
//
// NEXT_PUBLIC_* values are inlined at BUILD time — a runtime-only env var on a
// prebuilt (Docker/standalone) image cannot reach the browser bundle. Build
// with the DSN present, or live without client-side reporting (the server side
// gates on SENTRY_DSN independently in instrumentation.ts).
import { redactSecrets } from "./redact-secrets";
import { redactTokens } from "@/instrumentation-client";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * The scrub every reported error passes through.
 *
 * `instrumentation-client.ts`'s `beforeSend` redacts the event's URL and
 * transaction — the places a capability link arrives as a URL. It does NOT touch
 * the exception itself, and an exception is the other place those bytes travel: a
 * failed fetch throws with the request URL inside `error.message`, and a stack
 * frame carries the module URL of the page the candidate was on. So the same
 * `/schedule/<token>` that beforeSend strips out of `event.request.url` left the
 * deployment anyway, inside the message of the very error that caused the report.
 *
 * `redactSecrets` is the second half: an error raised while talking to a provider
 * can echo an auth header or an api-key field, and that string is mirrored from the
 * scan table (redact-secrets.ts), so nothing key-shaped rides out either.
 *
 * Applied by REWRITING the Error rather than by a beforeSend hook: this function
 * is the boundary reporter's own contract and must hold whatever the SDK is
 * configured to do, and a non-Error throw (a string, an object) has to be scrubbed
 * too — beforeSend only sees what the SDK managed to parse.
 */
function scrub(text: string): string {
  return redactSecrets(redactTokens(text));
}

/** The value actually handed to captureException: an Error carrying the scrubbed
 *  message/stack (name preserved, so the Sentry issue still groups by error type),
 *  or a scrubbed string for a non-Error throw. */
export function scrubbedForCapture(error: unknown): unknown {
  if (error instanceof Error) {
    const copy = new Error(scrub(error.message));
    copy.name = error.name;
    // A stack is optional per spec and absent in some engines; only rewrite what exists.
    if (typeof error.stack === "string") copy.stack = scrub(error.stack);
    // React attaches `digest` to a server-component error; it is an opaque hash the
    // operator matches against the server log, so it must survive the copy.
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") (copy as { digest?: string }).digest = digest;
    return copy;
  }
  if (typeof error === "string") return scrub(error);
  // Anything else (a thrown object/number) is reported by its stringification rather
  // than serialized whole: an arbitrary object is exactly where an unscrubbed
  // response body would hide.
  return scrub(String(error));
}

/** Report an error-boundary crash. Fire-and-forget: reporting must never
 *  break the error UI itself, and it no-ops entirely without a DSN. */
export function reportBoundaryError(error: unknown): void {
  if (!DSN) return;
  // Scrubbed BEFORE the dynamic import, so a reporter that fails to load has
  // already cost nothing and one that loads never sees the raw value.
  const safe = scrubbedForCapture(error);
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(safe);
    })
    .catch(() => {
      /* the error screen must render even if the reporter cannot load */
    });
}
