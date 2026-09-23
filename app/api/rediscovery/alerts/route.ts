import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { liveRediscoveryAlerts, sweepRediscoveryAlerts } from "@/app/_lib/rediscover";
import { dismissRediscoveryAlert } from "@/app/_lib/rediscovery-alert-store";

// Standing silver-medalist feed (idea-fdb45cd0). GET = the active, still-relevant
// alerts; PATCH {id} dismisses one; POST runs a pool-change sweep over published
// roles and returns the refreshed feed (the "a strong candidate entered the pool"
// trigger, on demand from the feed's Refresh).

// The POST sweep fans out recruiter_cli rankings (now bounded by a worker pool +
// per-role timeout + a roles-per-sweep ceiling in sweepRediscoveryAlerts). Give it
// the same generous provider budget the single-CLI campaign/outreach routes use so
// a legitimately busy sweep isn't killed at the platform's default serverless
// timeout mid-run (bug-ui-scan #2).
export const maxDuration = 180;

// The feed is read through ONE function, liveRediscoveryAlerts (rediscover.ts): relevance
// against LIVE job/pipeline state (a row persists between sweeps; dismissal is sticky)
// AND the same eligibility gate the rank and the write ask (withheldCandidateIds), so an
// erased, lapsed or opted-out person leaves the feed, and its `count`, the moment their
// state changes. Scoped to the session workspace; the POST returns the feed for the SAME
// resolved workspace its sweep ran on.

export async function GET() {
  try {
    const alerts = liveRediscoveryAlerts(await currentWorkspace());
    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : null;
    if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
    // Dismissal is STICKY (the UNIQUE (job_id, candidate_id) index makes every later
    // sweep an INSERT OR IGNORE no-op) and an alert id is NOT a capability token —
    // listRediscoveryAlerts hands it to every recruiter in the feed. So scope the
    // write to the caller's team; `dismissed: false` answers "not yours", "already
    // dismissed" and "never existed" identically, so it is no existence oracle.
    const dismissed = dismissRediscoveryAlert(id, await currentWorkspace());
    return NextResponse.json({ dismissed });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}

export async function POST(request: Request) {
  try {
    // THROTTLE: this is the heaviest compute surface in the jobs area — one call
    // fans out a `recruiter_cli` child PER published role (bounded by the worker
    // pool, the per-role timeout and the roles-per-sweep ceiling, but still N
    // subprocesses), which is exactly the shape rate-limit.ts exists for: "a route
    // that spends money or spawns a subprocess". It carried no limiter at all.
    // The route is session-gated, but in open mode (no KP_OPERATOR_PASSWORD) that
    // gate is a no-op for the whole API, so a held-open tab clicking Refresh could
    // keep the box saturated with ranking children indefinitely.
    //
    // 10/10min per IP, the same key shape as the other spend routes: a sweep can
    // legitimately run for minutes (maxDuration 180), so ten is far above any human
    // Refresh pace and still bounds the fan-out. BEFORE the sweep, so a refused
    // request has spawned nothing; the GET feed and PATCH dismiss stay unthrottled —
    // they are pure reads/writes and the feed polls them.
    if (!rateLimit(`rediscovery-sweep:${clientIpFrom(request.headers)}`, { limit: 10, windowMs: 10 * 60_000 })) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    // Sweep the CALLER's catalog, not the default tenant's (rediscovery-alerts #1):
    // this POST is the feed's Refresh, fired from one team's session, so the roles
    // swept and the alerts raised must match the feed the same request returns below.
    const ws = await currentWorkspace();
    const { jobsSwept, newAlerts, truncated, failedJobs } = await sweepRediscoveryAlerts({
      signal: request.signal,
      workspaceId: ws,
    });
    const alerts = liveRediscoveryAlerts(ws);
    // `failedJobs` is the honest half of `newAlerts`: a sweep whose rankings all died
    // used to return the same `newAlerts: 0` as a sweep that ran perfectly and found
    // nobody, so the Refresh reported a clean "nothing new" over a broken pipeline.
    // Additive on the wire — existing consumers keep reading jobsSwept/newAlerts.
    return NextResponse.json({ alerts, count: alerts.length, jobsSwept, newAlerts, truncated, failedJobs });
  } catch (error) {
    return safeJsonError(error, "api:rediscovery-alerts", "REDISCOVERY_ALERTS_FAILED");
  }
}
