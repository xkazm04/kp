import { NextRequest, NextResponse } from "next/server";
import { getJob, getPipelineEntry, setApproval } from "@/app/_lib/db";
import { jsonError } from "@/app/_lib/api-response";
import { normalizeSalaryBand } from "@/app/_lib/salary-band";
import { SIM_SALARY } from "@/app/features/shell/simulation/constants";


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
    // Sanitize the stored band through the shared helper: it swaps a backwards
    // range and rejects a partial/non-finite/non-positive band, so we fall back to
    // the demo defaults instead of advertising garbage. The fallback is single-sourced
    // from SIM_SALARY (the same band the demo JD publishes), so a degraded run can't
    // advertise a stale band that disagrees with the published role
    // (guided-pipeline-simulation #3). Midpoint sits within [min, max].
    const [min, max] = normalizeSalaryBand(band[0], band[1]) ?? [SIM_SALARY.suggestedMinimum, SIM_SALARY.suggestedMaximum];
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
    return jsonError(error, "Offer draft failed.");
  }
}
