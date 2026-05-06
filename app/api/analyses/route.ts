import { NextResponse } from "next/server";
import { listAnalyses } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = listAnalyses(200);
    return NextResponse.json({ analyses: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list analyses.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
