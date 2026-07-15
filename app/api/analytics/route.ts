import { NextResponse } from "next/server";
import { pipelineAnalytics, pipelineAnalyticsPrior } from "@/app/_lib/db";
import type { PipelineAnalytics } from "@/app/_lib/db/analytics";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { periodDeltas, type PeriodDeltas } from "@/app/_lib/analytics-deltas";
import { createAnalyticsCache } from "@/app/_lib/analytics-cache";


// ANA2 — bounds for the optional ?days= window. Absent/invalid → all time (the
// historical behavior); a numeric value clamps into range (same defensive-param
// posture as /api/analytics/decisions' clampInt).
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;

// Short-TTL per-(workspace, window) memo: repeat loads within the TTL skip the
// double aggregation (current + prior window). Module-scoped so it persists across
// requests; keyed so no payload crosses tenants or windows (see analytics-cache.ts).
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
    const ws = await currentWorkspace();
    const payload = payloadCache.get(ws, windowDays, () => {
      const current = pipelineAnalytics(windowDays, undefined, ws);
      // ce8e3c9e — only a windowed view has a well-defined "previous period". For
      // all-time (no window) there's nothing to compare against, so deltas are null.
      // channel-story-complete — the prior window feeds ONLY periodDeltas, which reads
      // a handful of scalars; pipelineAnalyticsPrior computes just those (2 queries)
      // instead of re-running the full ~9-query battery whose rest the route discards.
      const deltas = windowDays
        ? periodDeltas(current, pipelineAnalyticsPrior(windowDays, Date.now() - windowDays * 86_400_000, ws))
        : null;
      return { ...current, deltas };
    });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/analytics] failed to build pipeline analytics", error);
    const message = error instanceof Error ? error.message : "Failed to build analytics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
