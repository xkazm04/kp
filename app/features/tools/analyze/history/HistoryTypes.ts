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
  // RES5 — the note the recruiter typed WITH that disposition. listAnalyses has
  // always selected it and the route has always sent it; this row type dropped it,
  // so the reason for a pass/hold was fetched over the wire and thrown away on
  // arrival. Shown truncated beside the pill (full text in the cell's title).
  decision_note?: string | null;
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
// from whatever's actually in the loaded history. The order here is over the
// canonical English SLUGS (`sales_marketing`, `data_ai`); what the dropdown
// actually shows is the localized label, so the caller re-sorts by that — see
// sortOptionsByLabel.
export function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort();
}

// Filter-dropdown options ordered by what is ON SCREEN, in the reader's locale.
//
// Two bugs in one: the options were emitted in `distinct()`'s slug order, which
// is alphabetical only for a reader of English — under `cs` the same order
// renders as "Kreativa / design · Zákaznická podpora · Data / AI · Vzdělávání…",
// i.e. no order at all. And re-sorting them with a plain `<` / locale-less
// `localeCompare` would swap that for the classic Czech collation failure: `.sort()`
// compares UTF-16 code units, so Č/Ř/Š/Ž (U+010C…) all file AFTER Z — "Řemesla /
// technické profese" lands past "Zákaznická podpora", dead last. An Intl.Collator
// bound to the ACTIVE locale is the only ordering a Czech recruiter can scan
// (the rule analytics' `nameCollator` documents for candidate names).
//
// The leading "All role families" sentinel is prepended by the caller and is
// deliberately not part of the input, so it always stays first.
export function sortOptionsByLabel<T extends { label: string }>(options: T[], locale: string): T[] {
  // `numeric` matches the shared name comparator, so "Level 2" precedes "Level 10";
  // an unsupported tag makes the Intl constructor fall back rather than throw.
  const collator = new Intl.Collator(locale, { numeric: true });
  return [...options].sort((a, b) => collator.compare(a.label, b.label));
}
