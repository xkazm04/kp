// The walkthrough's fixture (roles, proposals, population), loaded on demand by the dev-only
// walkthrough data mode. Static data served from public/dev/cohort/ and fetched, never imported
// (the same reason as loadCohortFixture: JSON on an import graph is budgeted weight). Built by
// buildWalkthroughFixture.ts; walkthroughFixture.test.ts pins the file to the builder.
import type { WalkthroughFixture } from "../cohortWalkthroughModel";

export async function loadWalkthroughFixture(): Promise<WalkthroughFixture> {
  const res = await fetch("/dev/cohort/walkthrough.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`walkthrough fixture: HTTP ${res.status}`);
  // The file is the builder's output, checked by walkthroughFixture.test.ts.
  return (await res.json()) as WalkthroughFixture;
}
