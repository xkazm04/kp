import { NextResponse } from "next/server";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { teamBenchmark } from "@/app/_lib/db/org-benchmarks";
import { safeJsonError } from "@/app/_lib/api-response";

// Phase 2 (cross-company reference tier) — the org-wide hiring benchmark a team compares
// itself against. Returns the team's OWN stats plus the org AGGREGATE (org_id-join),
// which is withheld (available:false) below the k-anonymity floor. Aggregate-only: no
// candidate, raw row, or peer-team identity ever crosses the workspace boundary.
// bug-ui-scan-2026-07-09 (analytics-calibration-dashboards #3): the aggregate now EXCLUDES
// the caller's own team (teamBenchmark), so the floor covers only OTHER teams — a 2-team
// org can no longer be used to back the single peer's figures out of the caller's stats.
export async function GET() {
  try {
    const workspaceId = await currentWorkspace();
    return NextResponse.json(teamBenchmark(workspaceId));
  } catch (error) {
    return safeJsonError(error, "api:benchmarks", "BENCHMARK_FAILED");
  }
}
