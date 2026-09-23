import type { CaseFilters } from "./DevCasesTable.filter";

// Page sizes for GET /api/devcase. The door already pages (`?limit=`, max 500);
// the studio used to fetch the default 50 and never raise it, so assignments 51+
// did not exist for the Cases table.

export const CASE_PAGE_LIMITS = [50, 150, 500] as const;

export function nextCaseLimit(current: number): number {
  for (const n of CASE_PAGE_LIMITS) {
    if (n > current) return n;
  }
  return CASE_PAGE_LIMITS[CASE_PAGE_LIMITS.length - 1];
}

export function canRaiseCaseLimit(current: number): boolean {
  return nextCaseLimit(current) > current;
}

/** The ledger address. The filters are answered by the store BEFORE the limit
 *  (GET /api/devcase), so a filtered page is never empty while matches exist past it.
 *  Blank filters are omitted; the title is trimmed and folded the way the store folds
 *  it, so one search is one URL (and one cache entry) however it was typed. */
export function filterCasesUrl(input: { limit: number } & CaseFilters): string {
  const params = new URLSearchParams({ limit: String(input.limit) });
  const q = input.title.trim().toLocaleLowerCase();
  if (q) params.set("q", q);
  if (input.stage) params.set("stage", input.stage);
  if (input.seniority) params.set("seniority", input.seniority);
  return `/api/devcase?${params.toString()}`;
}
