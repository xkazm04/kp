"use client";

import type { useTranslations } from "next-intl";
import { CompletionCta } from "@/app/_components/CompletionCta";
import type { SortState } from "@/app/_components/table/useTableSort";
import type { CoachHandoffBlock, JdRow, JdSortCol, StatusFilter } from "./jdsLibrary";
import { CoachHandoffTrace } from "./JdsLedgerCoachTrace";
import { JdsLedgerTable } from "./JdsLedgerTable";
import type { FilterOption } from "./JdsLedgerFilterMenu";
import type { CoachEdit } from "@/app/features/library/jobs/jobsCoachApply";

// The "Saved" tab body (coach-handoff trace, ingested-confirmation banner, and
// the table) — extracted verbatim from JdsSavedLedger.tsx so that file stays
// under the 200-line split threshold.
export function JdsSavedLedgerPanel({
  active,
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
  onOpenRow,
  onDuplicate,
  onStartGenerate,
  t,
}: {
  active: boolean;
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
  onOpenRow: (row: JdRow, opts?: { history?: boolean }) => void;
  onDuplicate: (row: JdRow) => void;
  onStartGenerate: () => void;
  t: ReturnType<typeof useTranslations<"library.tab">>;
}) {
  return (
    <div className={active ? "mt-5" : "hidden"} aria-busy={rows == null && !error}>
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

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-panel">
        {error ? (
          <div className="flex flex-col items-start gap-3 px-4 py-5">
            <p className="text-base text-red-700">{error}</p>
            <button type="button" onClick={reload} className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-ink hover:bg-stone-50">
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
          <div className="border-t border-stone-200 px-4 py-2 text-right text-xs uppercase tracking-wide text-steel">
            {t("entryCount", { count: visible.length })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
