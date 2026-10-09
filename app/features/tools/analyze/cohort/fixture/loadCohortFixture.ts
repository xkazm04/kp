// STUB (spark analyze-v2-cohort): final signature; WP1 implements over the generated JSON.
import type { CohortView } from "../cohortTypes";

export async function loadCohortFixture(kind: "done" | "running"): Promise<CohortView> {
  void kind;
  throw new Error("loadCohortFixture: not implemented (WP1)");
}
