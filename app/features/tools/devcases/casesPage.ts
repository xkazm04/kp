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

export function casesListUrl(limit: number): string {
  return `/api/devcase?limit=${limit}`;
}
