// The ai_candidates units already reserved by in-flight work, for BOTH doors that spend them:
// each queued/running `analyze` task holds one unit, each queued/running `analyze_cohort`
// the fresh units it declared (`params.freshCount`). /api/analyze and /api/analyze/cohort
// both count through this, so neither door can overrun a hard cap past the other's work.
//
// listRecentTasks omits params (params: null on every list row), so a cohort's declared
// units are read through `paramsOf` (getTask by id). Before this helper the cohort door read
// `t.params` off the list row: always null, so in-flight cohorts reserved nothing at either
// door. Pure: the caller passes both, and keeps the count-to-startTask stretch free of awaits.
type TaskLike = { id: string; kind: string; status: string };

export function inFlightCandidateUnits(tasks: readonly TaskLike[], paramsOf: (taskId: string) => unknown): number {
  let units = 0;
  for (const t of tasks) {
    if (t.status !== "queued" && t.status !== "running") continue;
    if (t.kind === "analyze") units += 1;
    else if (t.kind === "analyze_cohort") {
      const declared = (paramsOf(t.id) as { freshCount?: unknown } | null | undefined)?.freshCount;
      if (typeof declared === "number" && declared > 0) units += declared;
    }
  }
  return units;
}
