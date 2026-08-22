// Next.js instrumentation — runs once per server process at startup. This is the
// app's clock: a heartbeat that drives the durable automation scheduler so the
// Task-7 policy pass happens on a cadence instead of only on a manual click.
//
// Safe by default: the schedule is DISABLED unless enabled via the Pipeline UI
// toggle or AUTOMATION_SCHEDULER_AUTOSTART=1, so the heartbeat ticks but does
// nothing until you opt in. An external cron hitting /api/automation/run remains
// an alternative for deployments that don't keep a long-lived Node process.
//
// The body lives in instrumentation.node.ts and is imported ONLY here, behind the
// NEXT_RUNTIME guard, so its SQLite/native imports never enter the edge/client
// compile of this hook (Next folds the guard to a constant per target and
// tree-shakes the import away — without this the bundler chases better-sqlite3 →
// bindings → `fs`, which doesn't exist off-Node).

// Server-side Sentry is DSN-gated on the repo's LightTrack precedent
// (pipeline/jobfit/llm/monitor.py activates only when LIGHTTRACK_URL is set):
// no SENTRY_DSN, no init, no SDK load, no egress. KP_OFFLINE=1 skips Sentry
// entirely regardless of the DSN — an air-gapped deploy must not even try
// (the offline fetch guard would refuse the transport anyway; this keeps the
// SDK from initializing at all). Pure env reads — safe in the edge compile.
function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN) && process.env.KP_OFFLINE !== "1";
}

// The server twin of the redaction in instrumentation-client.ts — same reasoning,
// same list, kept literal in both roots (a shared module would have to be safe in the
// browser bundle AND in the edge compile of this hook). onRequestError below reports
// the failing request, and on this product the failing request is routinely
// `/api/schedule/<token>` or `/api/data/<erasureToken>`, where the segment IS the
// candidate's credential. Without this a 500 on a candidate API shipped a working
// capability link to a third-party service.
const TOKEN_PATH =
  /(\/(?:api\/)?(?:schedule|interview|status|offer|data|invite|skill|skill-profile|agents\/report|channels\/inbound|devcase\/apply|devcase\/session)\/)[^/?#]+/gi;

function redactTokens(value: string): string {
  return value.replace(TOKEN_PATH, "$1[token]").replace(/([?&](?:token|t)=)[^&#]+/gi, "$1[token]");
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Install the KP_OFFLINE egress guard FIRST, before any code path can fetch, so a
  // hard no-egress self-host deployment refuses outbound calls from the very start
  // (E-SH-4). No-op unless KP_OFFLINE is set. `offline` is a pure env/URL module —
  // no SQLite/native imports — so it's safe to import in this edge-compiled hook.
  const { installOfflineFetchGuard } = await import("./app/_lib/offline");
  installOfflineFetchGuard();
  // Sentry AFTER the egress guard (its transport then plays by the same rules),
  // BEFORE the clock so scheduler-tick crashes are already reportable.
  if (sentryEnabled()) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      // Error reporting only — no performance tracing, no extra egress.
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.request?.url) event.request.url = redactTokens(event.request.url);
        if (event.transaction) event.transaction = redactTokens(event.transaction);
        return event;
      },
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.message) breadcrumb.message = redactTokens(breadcrumb.message);
        const data = breadcrumb.data;
        if (data) {
          for (const key of ["url", "from", "to"]) {
            if (typeof data[key] === "string") data[key] = redactTokens(data[key] as string);
          }
        }
        return breadcrumb;
      },
    });
  }
  const { startClock } = await import("./instrumentation-node");
  await startClock();
}

// Next calls this for every unhandled server request error (nested React
// Server Component errors included, which the route error boundaries never
// see server-side). Same gates as register(): Node runtime only, DSN set,
// not offline. The lazy import keeps the SDK out of every compile where the
// gate is closed at runtime.
type CaptureRequestErrorArgs = Parameters<(typeof import("@sentry/nextjs"))["captureRequestError"]>;
export async function onRequestError(...args: CaptureRequestErrorArgs): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !sentryEnabled()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
