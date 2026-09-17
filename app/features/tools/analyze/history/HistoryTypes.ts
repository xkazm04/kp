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

/**
 * Case- and diacritic-insensitive search key. Same fold as the profile roster
 * and the analytics audit log: a recruiter who cannot type Č still finds Čapek.
 * Copied rather than imported across feature modules (three lines).
 */
export function foldForSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** True when the History search needle hits the candidate label or the slug. */
export function historyRowMatchesQuery(row: Pick<AnalysisRow, "candidate_label" | "slug">, q: string): boolean {
  const needle = foldForSearch(q.trim());
  if (!needle) return true;
  return foldForSearch(row.candidate_label).includes(needle) || foldForSearch(row.slug).includes(needle);
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

/** The Showing-of line may name a total only when the page is complete. A
 *  truncated slice has no population figure — `rows.length` is the loaded cap. */
export function historyShowingTotal(loadedCount: number, truncated: boolean): number | null {
  return truncated ? null : loadedCount;
}
