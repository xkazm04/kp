import { NextRequest, NextResponse } from "next/server";
import { interviewedForJob } from "@/app/_lib/db";
import { INTERVIEW_RUBRIC, RATING_ANCHORS } from "@/app/_lib/interview-rubric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Side-by-side interview comparison for one job. Returns the fixed rubric + each
// interviewed candidate's scorecard, so candidates are compared on identical
// axes (per-competency evidence = the transcript highlights).
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job is required" }, { status: 400 });
  return NextResponse.json({
    rubric: INTERVIEW_RUBRIC,
    anchors: RATING_ANCHORS,
    candidates: interviewedForJob(jobId),
  });
}
