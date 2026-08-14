import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/app/_lib/db/jobs";
import { getPipelineEntry, setApproval } from "@/app/_lib/db/pipeline";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
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
    // Tenant: look the entry up in the CALLER'S team. Unscoped, this read only ever
    // found DEFAULT-team entries, so on any other team the run's own candidate came
    // back null and the demo died on "Pipeline entry not found" one step from the
    // offer — and the scoping doubles as the authorization check, since a stranger's
    // entryId simply doesn't resolve.
    const workspaceId = await currentWorkspace();
    const entry = getPipelineEntry(entryId, workspaceId);
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
    // The entry we just read is the tenant authority for the write (same row, same
    // team) — an unscoped setApproval matched nothing off the default team, so the
    // offer card never appeared in Decisions and "Send offer" had nothing to extend.
    setApproval(entryId, "offer_review", JSON.stringify(draft), entry.workspaceId);
    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return jsonError(error, "Offer draft failed.");
  }
}
