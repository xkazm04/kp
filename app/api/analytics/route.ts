import { NextResponse } from "next/server";
import { pipelineAnalytics } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ANA2 — bounds for the optional ?days= window. Absent/invalid → all time (the
// historical behavior); a numeric value clamps into range (same defensive-param
// posture as /api/analytics/decisions' clampInt).
const MIN_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 365;

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
    return NextResponse.json(pipelineAnalytics(parseWindowDays(searchParams.get("days"))));
  } catch (error) {
    console.error("[api/analytics] failed to build pipeline analytics", error);
    const message = error instanceof Error ? error.message : "Failed to build analytics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
