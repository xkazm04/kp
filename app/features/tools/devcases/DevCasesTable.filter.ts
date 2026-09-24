import type { DevCaseDetail, Lifecycle, Posting } from "./DevTypes";

export type CaseFilters = { title: string; stage: string; seniority: string };

/** The same stage the row displays when no lifecycle has claimed the case yet. */
export function caseStage(caseId: string, lifecycles: readonly Lifecycle[], postings: readonly Posting[]): string {
  return lifecycles.find((item) => item.caseId === caseId)?.stage
    ?? (postings.some((item) => item.caseId === caseId) ? "published" : "approved");
}

/** Filter only the loaded ledger page; the table keeps its truncation notice. */
export function filterCases(
  cases: readonly DevCaseDetail[],
  lifecycles: readonly Lifecycle[],
  postings: readonly Posting[],
  filters: CaseFilters,
): DevCaseDetail[] {
  const title = filters.title.trim().toLocaleLowerCase();
  return cases.filter((item) =>
    (!title || `${item.title ?? ""} ${item.roleTitle ?? ""}`.toLocaleLowerCase().includes(title))
    && (!filters.stage || caseStage(item.id, lifecycles, postings) === filters.stage)
    && (!filters.seniority || item.seniority === filters.seniority)
  );
}
