import { NextResponse } from "next/server";
import { listPipeline, PIPELINE_STAGES } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ entries: listPipeline(), stages: PIPELINE_STAGES });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load pipeline.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
