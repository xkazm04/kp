import { NextResponse } from "next/server";
import { listPipelineEvents } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ events: listPipelineEvents(40) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load activity.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
