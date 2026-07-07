import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { orgHiringBenchmark, orgIdForWorkspace, teamHiringStats, type OrgHiringBenchmark } from "@/app/_lib/db/org-benchmarks";
import { safeJsonError } from "@/app/_lib/api-response";

// Phase 2 (cross-company reference tier) — the org-wide hiring benchmark a team compares
// itself against. Returns the team's OWN stats plus the org AGGREGATE (org_id-join),
// which is withheld (available:false) below the k-anonymity floor. Aggregate-only: no
// candidate, raw row, or peer-team identity ever crosses the workspace boundary.
export async function GET() {
  try {
    const workspaceId = await currentWorkspace();
    const orgId = orgIdForWorkspace(workspaceId);
    const team = teamHiringStats(workspaceId);
    const org: OrgHiringBenchmark = orgId
      ? orgHiringBenchmark(orgId)
      : { available: false, contributingTeams: 0, totalEntries: 0, interviewRatePct: 0, hireRatePct: 0, medianTimeToHireDays: null };
    return NextResponse.json({ team, org });
  } catch (error) {
    return safeJsonError(error, "api:benchmarks", "BENCHMARK_FAILED");
  }
}
