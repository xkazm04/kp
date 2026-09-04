"use client";

import type { useTranslations } from "next-intl";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { BTN_SECONDARY, DIVIDER, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
import type { SortState } from "@/app/_components/table/useTableSort";
import { jdLibraryFooter, type CoachHandoffBlock, type JdRow, type JdSortCol, type StatusFilter } from "./jdsLibrary";
import { CoachHandoffTrace } from "./JdsLedgerCoachTrace";
import { JdsLedgerTable } from "./JdsLedgerTable";
import type { FilterOption } from "./JdsLedgerFilterMenu";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";

// The library page's body (coach-handoff trace, ingested-confirmation banner, and
// the table) — extracted from JdsSavedLedger.tsx so that file stays under the
// 200-line split threshold.
export function JdsSavedLedgerPanel({
  rows,
  error,
  reload,
  coachTrace,
  coachEdit,
  coachTargetRow,
  setCoachDismissed,
  ingested,
  setIngested,
  visible,
  total,
  truncated,
  query,
  setQuery,
  searchOpen,
  setSearchOpen,
  field,
  setField,
  fieldOptions,
  seniority,
  setSeniority,
  seniorityOptions,
  status,
  setStatus,
  statusOptions,
  sort,
  onSort,
  duplicating,
  heldBuilds,
  pollStalled,
  onOpenRow,
  onDuplicate,
  onStartGenerate,
  t,
}: {
  rows: JdRow[] | null;
  error: string | null;
  reload: () => void;
  coachTrace: CoachHandoffBlock | null;
  coachEdit: CoachEdit | null;
  coachTargetRow: JdRow | null;
  setCoachDismissed: (v: boolean) => void;
  ingested: { slug: string; jobId: string | null } | null;
  setIngested: (v: { slug: string; jobId: string | null } | null) => void;
  visible: JdRow[];
  /** The library's UNBOUNDED size from GET /api/jds, or null when the answer did
   *  not carry it. `rows` is one page, so `visible.length` is a slice of a slice. */
  total: number | null;
  /** The route cut the page it answered. */
  truncated: boolean;
  query: string;
  setQuery: (v: string) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  field: string | null;
  setField: (v: string | null) => void;
  fieldOptions: FilterOption[];
  seniority: string | null;
  setSeniority: (v: string | null) => void;
  seniorityOptions: FilterOption[];
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  statusOptions: FilterOption[];
  sort: SortState<JdSortCol>;
  onSort: (col: JdSortCol) => void;
  duplicating: string | null;
  heldBuilds: Set<string>;
  /** The analyzing-row poll gave up (jdsBuildPoll). Stated, never silent. */
  pollStalled: boolean;
  onOpenRow: (row: JdRow, opts?: { history?: boolean }) => void;
  onDuplicate: (row: JdRow) => void;
  onStartGenerate: () => void;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  return (
    // The library page IS this panel now (the Saved/Generate/Intake strip moved to
    // the Job-intake tab), so there is no shown/hidden state left to animate — the
    // tab's own entrance carries it.
    <div aria-busy={rows == null && !error}>
      {coachTrace ? (
        <CoachHandoffTrace
          cause={coachTrace}
          slug={coachEdit?.slug ?? ""}
          title={coachTargetRow?.title}
          onDismiss={() => setCoachDismissed(true)}
        />
      ) : null}

      {ingested ? (
        <CompletionCta
          className="mb-4"
          message={t("ingestedBanner", { slug: ingested.slug })}
          links={[{ label: t("ingestedBannerCta"), tab: "jobs", params: ingested.jobId ? { job: ingested.jobId } : undefined }]}
          onDismiss={() => setIngested(null)}
          dismissLabel={t("ingestedDismiss")}
        />
      ) : null}

      {pollStalled ? (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800">
          {t("pollStalledNote")}
        </p>
      ) : null}

      <div className={`overflow-hidden ${PANEL}`}>
        {error ? (
          <div className="flex flex-col items-start gap-3 px-4 py-5">
            <p className="text-base text-red-700">{error}</p>
            <button type="button" onClick={reload} className={`${BTN_SECONDARY} h-9 gap-2 bg-white px-3 text-sm font-semibold`}>
              {t("tryAgain")}
            </button>
          </div>
        ) : (
          // Tier 1: the table's own chrome (column headers, the search box and the
          // Field/Seniority/Status filter menus) depends on nothing and renders
          // unconditionally — only the tbody content below is data-dependent.
          <JdsLedgerTable
            rows={rows}
            visible={visible}
            query={query}
            setQuery={setQuery}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            field={field}
            setField={setField}
            fieldOptions={fieldOptions}
            seniority={seniority}
            setSeniority={setSeniority}
            seniorityOptions={seniorityOptions}
            status={status}
            setStatus={setStatus}
            statusOptions={statusOptions}
            sort={sort}
            onSort={onSort}
            reload={reload}
            duplicating={duplicating}
            onOpenRow={onOpenRow}
            onDuplicate={onDuplicate}
            onIngested={(slug, jobId) => setIngested({ slug, jobId })}
            onStartGenerate={onStartGenerate}
            heldBuilds={heldBuilds}
          />
        )}
        {rows && visible.length > 0 ? (
          <div className={`${DIVIDER} px-4 py-2 text-right ${META_LABEL}`}>
            {/* "200 entries" over a 240-JD library was a page's size presented as
                the library, with no way to reach the other 40. The fold decides
                whether an M can honestly be stated (jdsLibrary.ts). */}
            {(() => {
              const footer = jdLibraryFooter(visible.length, total, truncated);
              return footer.key === "entryCountOfTotal"
                ? t("entryCountOfTotal", { count: footer.count, total: footer.total })
                : t("entryCount", { count: footer.count });
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
