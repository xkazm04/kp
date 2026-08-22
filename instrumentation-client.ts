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

// EVERY candidate surface in this app is a CAPABILITY LINK: the opaque segment in
// `/schedule/<token>`, `/interview/<token>`, `/offer/<token>`, `/status/<token>`,
// `/data/<erasureToken>` IS the credential (docs/architecture — "capability links,
// never sessions"). Sentry attaches the page URL to every event and records a
// navigation breadcrumb per route change, so with a DSN configured a single client
// error on a candidate page shipped a WORKING capability link to a third-party
// service — anyone with project access could then open that candidate's schedule,
// interview, offer or, worst of all, their one-click erasure page. `tracesSampleRate:
// 0` does not help: this rides on error events, not traces.
//
// Redact the segment AFTER a token-bearing prefix, in the two places a URL enters an
// event. Deliberately a denylist of the token routes rather than a blanket scrub:
// `/jds/<slug>` or `/?tab=hiring` are exactly the context that makes a stack trace
// actionable, and losing them would be paid for on every debugging session.
//
// The server twin of this list lives in instrumentation.ts (captureRequestError sees
// the same paths as `/api/...`). Kept literal in both roots on purpose: a shared
// module would have to be safe in the browser bundle AND in the edge compile of the
// instrumentation hook, and these two files are its only consumers.
const TOKEN_PATH =
  /(\/(?:api\/)?(?:schedule|interview|status|offer|data|invite|skill|skill-profile|agents\/report|channels\/inbound|devcase\/apply|devcase\/session)\/)[^/?#]+/gi;

/** Replace a capability token with a placeholder, leaving the route shape readable. */
export function redactTokens(value: string): string {
  return value.replace(TOKEN_PATH, "$1[token]").replace(/([?&](?:token|t)=)[^&#]+/gi, "$1[token]");
}

function redactUnknown(value: unknown): unknown {
  return typeof value === "string" ? redactTokens(value) : value;
}

if (dsn) {
  import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn,
        // Error reporting only — no performance tracing, no extra egress.
        tracesSampleRate: 0,
        // Navigation/fetch/xhr breadcrumbs carry the URL they moved to or called.
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.message) breadcrumb.message = redactTokens(breadcrumb.message);
          const data = breadcrumb.data;
          if (data) {
            for (const key of ["url", "from", "to"]) {
              if (key in data) data[key] = redactUnknown(data[key]);
            }
          }
          return breadcrumb;
        },
        // The event's own URL + the resolved route name.
        beforeSend(event) {
          if (event.request?.url) event.request.url = redactTokens(event.request.url);
          if (event.transaction) event.transaction = redactTokens(event.transaction);
          return event;
        },
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
      // Redacted at the source: this href is a candidate's capability link on every
      // navigation into /schedule, /interview, /offer, /status or /data.
      Sentry.captureRouterTransitionStart(redactTokens(href), navigationType);
    })
    .catch(() => {
      /* noop */
    });
}
