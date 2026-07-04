import { NextResponse } from "next/server";
import { listAnalysesByJd, loadJd } from "@/app/_lib/db";
import { safeJsonError } from "@/app/_lib/api-response";


// Recruiter-side read behind the Library tab's expandable "Candidates (N)" row
// section (biz-ui scan 2026-06-12 #1). This list — candidate_label (typically a
// real name), score, seniority — used to server-render on the public
// /jds/[slug] page, which is deliberately candidate-facing (Apply CTA,
// shareable ?lang=cs links): a personal-data exposure. It now loads lazily
// here, only when a recruiter expands the row in the workspace.
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    if (!loadJd(slug)) {
      return NextResponse.json({ error: "JD not found." }, { status: 404 });
    }
    return NextResponse.json({ analyses: listAnalysesByJd(slug) });
  } catch (error) {
    return safeJsonError(error, "api:jds/[slug]/analyses", "JD_ANALYSES_FAILED");
  }
}
