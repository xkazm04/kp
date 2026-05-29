import { NextRequest, NextResponse } from "next/server";
import { listJobs, jobStats } from "@/app/_lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const entry = sp.get("entryEligible");
    const limitRaw = sp.get("limit");
    const jobs = listJobs({
      roleFamily: sp.get("roleFamily") ?? undefined,
      seniority: sp.get("seniority") ?? undefined,
      workMode: sp.get("workMode") ?? undefined,
      entryEligible: entry === null ? undefined : entry === "true" || entry === "1",
      q: sp.get("q") ?? undefined,
      limit: limitRaw ? Number(limitRaw) : undefined,
    });
    return NextResponse.json({ jobs, stats: jobStats() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list jobs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
