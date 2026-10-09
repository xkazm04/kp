"use client";

// STUB (spark analyze-v2-cohort WP0): the Loom prototype world. Its builder replaces the
// body with the L0 comparison world and its own descent into DimensionPage.
import type { CohortWorldProps } from "../../cohortTypes";

export function LoomWorld({ view }: CohortWorldProps) {
  return <div data-cohort-world="loom" data-members={view.members.length} />;
}
