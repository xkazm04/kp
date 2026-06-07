import { NextResponse } from "next/server";
import { listPipelineEvents } from "@/app/_lib/db";
import { toPublicPipelineEvent } from "@/app/_lib/pipeline-events-public";
import { safeJsonError } from "@/app/_lib/api-response";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Public projection (idea-4c41d103): this endpoint is reachable without
    // auth, so identity is reduced to initials and the internal entry id +
    // archetype never leave the server. See pipeline-events-public.ts.
    return NextResponse.json({ events: listPipelineEvents(40).map(toPublicPipelineEvent) });
  } catch (error) {
    return safeJsonError(error, "api:pipeline:events", "PIPELINE_EVENTS_FAILED");
  }
}
