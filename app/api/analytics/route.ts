import { NextResponse } from "next/server";
import { pipelineAnalytics } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The decision log is paginated separately via /api/analytics/decisions so the
// full audit trail is never bundled into this summary payload.
export async function GET() {
  return NextResponse.json(pipelineAnalytics());
}
