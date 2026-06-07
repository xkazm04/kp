import { NextResponse } from "next/server";
import { listPipelineEvents } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ events: listPipelineEvents(40) });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:events", "PIPELINE_EVENTS_FAILED");
  }
}
