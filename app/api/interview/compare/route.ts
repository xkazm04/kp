import { NextRequest, NextResponse } from "next/server";
import { interviewedForJob } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";
import { INTERVIEW_RUBRICS, RATING_ANCHORS } from "@/app/_lib/interview-rubric";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Side-by-side interview comparison for one job. Returns the rubrics keyed by
// scoringModel + each interviewed candidate's scorecard (which carries its own
// scoringModel), so the grid compares candidates on the axes for THEIR cohort —
// a student's 6 potential constructs and an experienced hire's 5 axes line up
// within their own cohort rather than being forced onto one rubric.
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job");
  if (!jobId) return NextResponse.json({ error: "job is required" }, { status: 400 });
  try {
    return NextResponse.json({
      rubrics: INTERVIEW_RUBRICS,
      anchors: RATING_ANCHORS,
      candidates: interviewedForJob(jobId),
    });
  } catch (error) {
    // Previously uncaught — a thrown SQLite error fell through to the framework
    // handler, which in dev forwards internal detail (idea-ab117371).
    return safeJsonError(error, "api:interview:compare", "INTERVIEW_LOOKUP_FAILED");
  }
}
