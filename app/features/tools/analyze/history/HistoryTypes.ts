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
  // Which producer scored this row. listAnalyses already SELECTs both; NULL on a
  // row saved before the columns existed is unknown, never assumed to be an LLM.
  engine?: string | null;
  engine_provider?: string | null;
};

export const ANALYSIS_PRODUCERS = ["llm", "deterministic", "unknown"] as const;
export type AnalysisProducer = (typeof ANALYSIS_PRODUCERS)[number];

/** Map the stored engine marker to the chip the History row paints. A null, blank,
 *  or unrecognised value is unknown — never "llm". */
export function analysisProducer(engine: string | null | undefined): AnalysisProducer {
  return engine === "llm" || engine === "deterministic" ? engine : "unknown";
}

export const PRODUCER_STYLE: Record<AnalysisProducer, string> = {
  llm: "bg-moss/10 text-moss",
  deterministic: "bg-stone-100 text-steel",
  unknown: "bg-amber-100 text-amber-800",
};

// RES5 — the recruiter's recorded decision on a saved analysis, shown as a pill on
// the history row. Tone mirrors the decision queue's language.
export const DISPOSITION_STYLE: Record<string, string> = {
  advance: "bg-moss/10 text-moss",
  hold: "bg-dial-amber/20 text-ink",
  pass: "bg-coral/10 text-coral",
};

// Distinct, sorted, non-null values of a column. The filter dropdowns no longer
// derive from the loaded rows (the server answers the workspace's facets, see
// historyQuery.ts), but the facets arrive in this same order: over the
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

// GET /api/analyses now answers `{ analyses, truncated, limit }` so a workspace
// past the cap can stop claiming completeness. Inventing `truncated: false` when
// the route said nothing would be a completeness claim the server never made.
export type AnalysesListPage = {
  analyses: AnalysisRow[];
  truncated: boolean;
  limit: number | null;
};

/** Read a `/api/analyses` body into what History renders. A missing/non-array
 *  `analyses` is an empty list, never `undefined` reaching the table. */
export function readAnalysesListPayload(payload: unknown): AnalysesListPage {
  const body = (
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
  ) as { analyses?: unknown; truncated?: unknown; limit?: unknown };
  const analyses = Array.isArray(body.analyses) ? (body.analyses as AnalysisRow[]) : [];
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
      ? Math.floor(body.limit)
      : null;
  return { analyses, truncated: body.truncated === true, limit };
}
