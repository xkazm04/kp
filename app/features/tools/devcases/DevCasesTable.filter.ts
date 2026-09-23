// The Cases ledger's filters. They used to run HERE, in memory, over whatever page the
// client held (and against a lifecycle list capped at 50), so a stage filter answered
// for the loaded page rather than the library. They are now a query: casesPage.ts
// builds the address and the store filters before the limit (db/devcase.ts
// listCaseLedger). What stays client-side is the shape and whether anything is set.

export type CaseFilters = { title: string; stage: string; seniority: string };

export const EMPTY_CASE_FILTERS: CaseFilters = { title: "", stage: "", seniority: "" };

/** True when a filter would narrow the query. An empty ledger under an active filter
 *  is "no matches", not the first-run empty state. */
export function caseFiltersActive(filters: CaseFilters): boolean {
  return Boolean(filters.title.trim() || filters.stage || filters.seniority);
}
