// Client-side Sentry init — Next's instrumentation-client convention: this
// module runs once in the browser before the app hydrates. DSN-gated on the
// repo's LightTrack precedent (monitor.py activates only when LIGHTTRACK_URL
// is set): without NEXT_PUBLIC_SENTRY_DSN nothing initializes and the SDK
// stays an unfetched async chunk, so the default local-first deploy performs
// no telemetry egress from the browser at all. An offline/air-gapped deploy
// (KP_OFFLINE=1) must simply not set the DSN — KP_OFFLINE itself is a
// server-only var that never reaches this bundle.
//
// NEXT_PUBLIC_* is inlined at BUILD time; see app/_lib/sentry-client.ts.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        // Error reporting only — no performance tracing, no extra egress.
        tracesSampleRate: 0,
      });
    })
    .catch(() => {
      /* never let a failed telemetry load affect the app */
    });
}

// App Router navigation hook (the @sentry/nextjs convention export). With
// tracing sampled at 0 this only breadcrumbs the navigation; it must exist
// as a module export at build time, so it forwards lazily and no-ops when
// the DSN gate is closed.
export function onRouterTransitionStart(href: string, navigationType: string): void {
  if (!dsn) return;
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.captureRouterTransitionStart(href, navigationType);
    })
    .catch(() => {
      /* noop */
    });
}
