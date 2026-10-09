// The Cohort Studio fixtures, loaded on demand. Client-safe: the JSON is reached only
// through a dynamic import(), so neither fixture enters a bundle until a world asks for
// it. The files are the REAL engine output — regenerate them with buildFixture.ts.
import type { CohortView } from "../cohortTypes";

export async function loadCohortFixture(kind: "done" | "running"): Promise<CohortView> {
  const mod = kind === "done" ? await import("./cohort20.done.json") : await import("./cohort20.running.json");
  // JSON widens every literal union to string; the file is engine output, checked by cohortFixture.test.ts.
  return ((mod as { default?: unknown }).default ?? mod) as CohortView;
}
