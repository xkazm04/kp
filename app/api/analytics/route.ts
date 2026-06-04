import { NextResponse } from "next/server";
import { pipelineAnalytics } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The decision log is paginated separately via /api/analytics/decisions so the
// full audit trail is never bundled into this summary payload.
export async function GET() {
  // pipelineAnalytics() aggregates every pipeline_entries row, so this is exactly
  // where a transient DB fault (locked mid-write, corrupt file, migration race,
  // disk full) surfaces. Match the sibling routes (e.g. /api/matrix): log with
  // context for diagnosis and return a structured { error } 500 instead of an
  // opaque, body-less crash.
  try {
    return NextResponse.json(pipelineAnalytics());
  } catch (error) {
    console.error("[api/analytics] failed to build pipeline analytics", error);
    const message = error instanceof Error ? error.message : "Failed to build analytics.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
