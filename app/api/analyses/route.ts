import { NextResponse } from "next/server";
import { listAnalyses } from "@/app/_lib/db/analyses";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


export async function GET() {
  try {
    const rows = listAnalyses(200, await currentWorkspace());
    return NextResponse.json({ analyses: rows });
  } catch (error) {
    // Log the full error server-side; return a generic, stable message so the
    // SQLite path and engine internals never reach the client.
    console.error("[api:analyses] failed to list analyses", error);
    return NextResponse.json({ error: "Failed to load analyses." }, { status: 500 });
  }
}
