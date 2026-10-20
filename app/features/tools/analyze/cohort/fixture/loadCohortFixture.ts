// The Cohort Studio fixtures, loaded on demand by the dev-only prototype switcher.
// They are STATIC DATA served from public/dev/cohort/, fetched rather than imported: an
// import() of 180 KB of JSON put the data on app/page.tsx's budgeted graph (the perf
// walker follows dynamic imports). The files are the REAL engine output — regenerate
// them with buildFixture.ts; cohortFixture.test.ts pins them to the engine.
import type { CohortView } from "../cohortTypes";

export async function loadCohortFixture(kind: "done" | "running"): Promise<CohortView> {
  const res = await fetch(`/dev/cohort/cohort20.${kind}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`cohort fixture ${kind}: HTTP ${res.status}`);
  // JSON widens every literal union to string; the file is engine output, checked by cohortFixture.test.ts.
  return (await res.json()) as CohortView;
}
