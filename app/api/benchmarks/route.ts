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
//
// UAT KAT-ANA-5 — WINDOW SCOPE: this route takes no `days` parameter, deliberately, and the
// panel that reads it says so on screen (analytics.orgBenchmark.scopeAllTime). Threading the
// Analytics tab's 30/90-day switcher in here was considered and REFUSED on two grounds, both
// of which would make the control's promise worse than its absence:
//   1. k-anonymity. BENCHMARK_MIN_ENTRIES/BENCHMARK_MIN_TEAMS are the floor that lets an
//      aggregate cross a workspace boundary at all. A 30-day slice drops most orgs below it,
//      so picking a window would not narrow the benchmark — it would WITHHOLD it. A switcher
//      that deletes the panel is not a scoped view.
//   2. Truncation bias. medianTimeToHireDays is measured created→Hired over entries CREATED
//      in the window, so a 30-day cohort can only contain hires that already finished: the
//      slow ones are structurally absent and the median reads low. That is exactly the "quiet
//      wrong number a benchmark must not produce" statsFrom() was rewritten to avoid.
// If a windowed benchmark is ever wanted it needs its own basis (completed-in-window, with
// the floor recomputed per window) — not a `days` param bolted onto this one.
export async function GET() {
  try {
    const workspaceId = await currentWorkspace();
    return NextResponse.json(teamBenchmark(workspaceId));
  } catch (error) {
    return safeJsonError(error, "api:benchmarks", "BENCHMARK_FAILED");
  }
}
