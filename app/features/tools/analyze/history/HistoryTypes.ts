// Shared row shape + small pure helpers for the History tab, split out of
// HistoryTab.tsx so the filter bar and table can both import them.

export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  jd_slug: string | null;
  score: number | null;
  role_family: string | null;
  seniority: string | null;
  created_at: string;
  disposition?: string | null;
  // SCOR2 — warn-shaped sanity-check count stamped at save time; NULL on rows
  // saved before the column existed (no pill).
  review_flags?: number | null;
  // Content-addressed identity: how many OLDER re-runs of the same CV+JD this row
  // supersedes (the list collapses them to the newest). 0/absent = a first/only run.
  prior_runs?: number | null;
};

// RES5 — the recruiter's recorded decision on a saved analysis, shown as a pill on
// the history row. Tone mirrors the decision queue's language.
export const DISPOSITION_STYLE: Record<string, string> = {
  advance: "bg-moss/10 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  pass: "bg-coral/10 text-coral",
};

// Distinct, sorted, non-null values of a column — drives the filter dropdowns
// from whatever's actually in the loaded history.
export function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}
