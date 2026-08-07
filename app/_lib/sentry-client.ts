// Client-side Sentry reporting — DSN-gated, following the repo's LightTrack
// precedent (pipeline/jobfit/llm/monitor.py activates only when LIGHTTRACK_URL
// is set): with NEXT_PUBLIC_SENTRY_DSN unset the SDK chunk is never even
// fetched, so the default local-first deploy ships zero telemetry code paths.
//
// NEXT_PUBLIC_* values are inlined at BUILD time — a runtime-only env var on a
// prebuilt (Docker/standalone) image cannot reach the browser bundle. Build
// with the DSN present, or live without client-side reporting (the server side
// gates on SENTRY_DSN independently in instrumentation.ts).
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/** Report an error-boundary crash. Fire-and-forget: reporting must never
 *  break the error UI itself, and it no-ops entirely without a DSN. */
export function reportBoundaryError(error: unknown): void {
  if (!DSN) return;
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureException(error);
    })
    .catch(() => {
      /* the error screen must render even if the reporter cannot load */
    });
}
