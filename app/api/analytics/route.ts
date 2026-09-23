import { NextResponse } from "next/server";
import { pipelineAnalytics, pipelineAnalyticsPrior } from "@/app/_lib/db/analytics";
import type { PipelineAnalytics } from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { periodDeltas, type PeriodDeltas } from "@/app/_lib/analytics-deltas";
import { deltaWindows } from "@/app/_lib/analytics-cohort";
import { createAnalyticsCache } from "@/app/_lib/analytics-cache";
import { parseJobParam } from "@/app/features/insights/analytics/analyticsJobScope";


// ANA2 — bounds for the optional ?days= window. Absent/invalid → all time (the
// historical behavior); a numeric value clamps into range (same defensive-param
// posture as /api/analytics/decisions' clampInt).
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;

// Short-TTL per-(workspace, window, role) memo: repeat loads within the TTL skip the
// double aggregation (current + prior window). Module-scoped so it persists across
// requests; keyed so no payload crosses tenants, windows or roles (see analytics-cache.ts).
type AnalyticsPayload = PipelineAnalytics & { deltas: PeriodDeltas | null };
const payloadCache = createAnalyticsCache<AnalyticsPayload>();

function parseWindowDays(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, Math.trunc(n)));
}

// The decision log is paginated separately via /api/analytics/decisions so the
// full audit trail is never bundled into this summary payload.
export async function GET(request: Request) {
  // pipelineAnalytics() aggregates every pipeline_entries row, so this is exactly
  // where a transient DB fault (locked mid-write, corrupt file, migration race,
  // disk full) surfaces. Match the sibling routes (e.g. /api/matrix): log with
  // context for diagnosis and return a structured { error } 500 instead of an
  // opaque, body-less crash.
  try {
    const { searchParams } = new URL(request.url);
    const windowDays = parseWindowDays(searchParams.get("days"));
    // ?job= — one requisition. Blank / over-long / malformed = the workspace view. The
    // role rides into BOTH reads and the memo key: a role's deltas compare the role
    // with itself, and a scoped payload is never served to another scope. A job of
    // another workspace yields an empty cohort (every read is workspace-predicated).
    const jobId = parseJobParam(searchParams.get("job"));
    const ws = await currentWorkspace();
    const payload = payloadCache.get(ws, windowDays, () => {
      // challenge-r06 — ONE clock per request. Both windows derive from it
      // (deltaWindows): the prior window's end IS the live window's cutoff, the same
      // number, so the two reads tile instead of each computing its own boundary.
      const nowMs = Date.now();
      const windows = windowDays ? deltaWindows(nowMs, windowDays) : null;
      const current = pipelineAnalytics(windowDays, jobId ? { jobId, nowMs } : { nowMs }, ws);
      // ce8e3c9e — only a windowed view has a well-defined "previous period". For
      // all-time (no window) there's nothing to compare against, so deltas are null.
      // channel-story-complete — the prior window feeds ONLY periodDeltas, which reads
      // a handful of scalars; pipelineAnalyticsPrior computes just those (2 queries)
      // instead of re-running the full ~9-query battery whose rest the route discards.
      const deltas = windowDays && windows
        ? periodDeltas(current, pipelineAnalyticsPrior(windowDays, windows.prior.endExclusive, ws, { jobId }))
        : null;
      return { ...current, deltas };
    }, jobId);
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/analytics] failed to build pipeline analytics", error);
    const message = error instanceof Error ? error.message : "Failed to build analytics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
