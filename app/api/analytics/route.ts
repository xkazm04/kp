import { NextResponse } from "next/server";
import { listPipelineEvents, pipelineAnalytics } from "@/app/_lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...pipelineAnalytics(), recentDecisions: listPipelineEvents(40) });
}
