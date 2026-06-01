import { NextRequest, NextResponse } from "next/server";
import { getJob, getPipelineEntry, setApproval } from "@/app/_lib/db";

export const runtime = "nodejs";

// Deterministic offer draft for the simulation spine — NO LLM (salary from the
// job-band midpoint), so the keyless run doesn't depend on the Claude CLI offer
// task. Sets the offer_review approval the recruiter then "Send offer"-extends.
export async function POST(request: NextRequest) {
  try {
    const { entryId } = (await request.json()) as { entryId?: string };
    if (!entryId) return NextResponse.json({ error: "entryId is required." }, { status: 400 });
    const entry = getPipelineEntry(entryId);
    if (!entry) return NextResponse.json({ error: "Pipeline entry not found." }, { status: 404 });

    const band = (entry.jobId ? getJob(entry.jobId)?.salaryBand : null) ?? [];
    // Order the bounds so a partial/typo'd band (e.g. [300000]) can't yield min > max;
    // recompute the midpoint AFTER ordering so it always sits within [min, max].
    const lo = band[0] ?? 120000;
    const hi = band[1] ?? 165000;
    const min = Math.min(lo, hi);
    const max = Math.max(lo, hi);
    const recommended = Math.round((min + max) / 2);
    const draft = {
      subject: `Offer: ${entry.jobTitle ?? "a role"}`,
      body: `Hi ${entry.candidateLabel},\n\nWe're delighted to extend you an offer to join us as ${entry.jobTitle ?? "the team"}.`,
      currency: "CZK",
      recommended,
      salaryMin: min,
      salaryMax: max,
      rationale: "Salary positioned at the role-band midpoint, scaled by fit.",
    };
    setApproval(entryId, "offer_review", JSON.stringify(draft));
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Offer draft failed." }, { status: 500 });
  }
}
