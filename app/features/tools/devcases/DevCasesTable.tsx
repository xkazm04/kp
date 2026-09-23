"use client";

import { useState } from "react";
import { AlarmClock, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusChip, StatusLegend } from "@/app/_components/StatusChip";
import { DIVIDER, PANEL } from "@/app/_components/ui/recipes";
import { assignmentStageTone } from "@/app/_lib/status-tone";
import { useRelativeTime } from "@/app/_lib/use-relative-time";
import type { LoadState } from "@/app/_lib/useLoader";
import { CasesEmpty } from "./DevCasesEmpty";
import type { CaseFilters } from "./DevCasesTable.filter";
import { stallForCase } from "./DevCasesTable.stall";
import { useStageLabel } from "./DevLabels";
import type { CaseLedgerFacets, CaseLedgerRow } from "./DevTypes";

// ONE THREAD (gap 8) — the local `stageChip` tint table is gone. It knew three
// states (approval gate = amber, LIVE_STAGES = moss, everything else = paper) and
// so collapsed `intake` and `closed` into the same neutral chip while painting the
// approval gate the same amber a closed JOB used one tab away. Tone now comes from
// the shared per-axis table in app/_lib/status-tone.ts, which is exhaustive over
// all ten orchestrator stages and pinned to that producer by its own test.

/** The Cases tab's first page: every designed assignment as one ledger row. Stage,
 *  submission count and the stall inputs arrive ON the row (GET /api/devcase, joined by
 *  the store over the whole workspace); they used to be derived here from the 50
 *  newest lifecycles and every posting, and read the fallback stage past that window.
 *  The filters are a query the store answers before the limit. Row click opens the
 *  readable detail. */
export function CasesTable({
  cases,
  truncated,
  facets,
  filters,
  filtersActive,
  onFiltersChange,
  state,
  onOpen,
  onDefine,
  onLoadMore,
}: {
  cases: CaseLedgerRow[];
  /** The server cut the page (GET /api/devcase answers `truncated`). Said out loud
   *  below: a list that silently stops at its page size is indistinguishable from a
   *  studio that has exactly that many cases. */
  truncated: boolean;
  /** The pickers' vocabulary for the whole workspace, not the (filtered) page. */
  facets: CaseLedgerFacets;
  filters: CaseFilters;
  /** A filter is narrowing the query: an empty answer is "no matches", not first run. */
  filtersActive: boolean;
  onFiltersChange: (next: CaseFilters) => void;
  state: LoadState;
  onOpen: (id: string) => void;
  onDefine: () => void;
  /** Raises `?limit=` on the next fetch. Absent when the page is not cut, or when
   *  the door's max (500) is already in force. */
  onLoadMore?: () => void;
}) {
  const rel = useRelativeTime();
  const t = useTranslations("devcase.casesTable");
  const tLife = useTranslations("devcase.lifecycle");
  const stageLabel = useStageLabel();
  // Snapshotted once at mount (Date.now() is impure in render) — same contract as LifecycleRow.
  const [nowMs] = useState(() => Date.now());
  // Tier 2 (docs/design/loading-choreography.md): useLoader's `data` starts as `[]`, so
  // an empty list is ambiguous between "still loading" and "genuinely no cases
  // yet" — `state.lastUpdated` disambiguates. Never loaded + healthy: hold the
  // table's height, invisibly, rather than jumping straight to the empty state.
  if (cases.length === 0 && !filtersActive && state.lastUpdated == null && !state.failed) {
    return <div className="reveal-quiet min-h-[16rem]" aria-hidden />;
  }
  // First-run empty list. CasesEmpty renders the sealed-ledger variant directly —
  // the local prototype switcher this comment used to describe is gone, so what
  // DevCasesEmptyLedger says about the controls IS the shipped marketing surface.
  if (cases.length === 0 && !filtersActive) {
    return <CasesEmpty state={state} onDefine={onDefine} />;
  }
  // A chosen value stays in its picker even if the facets have not caught up with it.
  const stages = facets.stages.includes(filters.stage) || !filters.stage ? facets.stages : [...facets.stages, filters.stage];
  const seniorities = facets.seniorities.includes(filters.seniority) || !filters.seniority
    ? facets.seniorities
    : [...facets.seniorities, filters.seniority];

  return (
    <div className={`overflow-hidden ${PANEL}`}>
      <div className="flex flex-wrap gap-2 border-b border-stone-200 bg-paper/40 px-3 py-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-micro font-semibold text-steel">
          {t("filterTitle")}
          <input type="search" value={filters.title} onChange={(event) => onFiltersChange({ ...filters, title: event.target.value })}
            className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-sm font-normal text-ink" />
        </label>
        <label className="flex min-w-36 flex-col gap-1 text-micro font-semibold text-steel">
          {t("colStage")}
          <select value={filters.stage} onChange={(event) => onFiltersChange({ ...filters, stage: event.target.value })}
            className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-sm font-normal text-ink">
            <option value="">{t("allStages")}</option>
            {stages.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}
          </select>
        </label>
        <label className="flex min-w-36 flex-col gap-1 text-micro font-semibold text-steel">
          {t("colSeniority")}
          <select value={filters.seniority} onChange={(event) => onFiltersChange({ ...filters, seniority: event.target.value })}
            className="focus-ring h-9 rounded-md border border-stone-200 bg-white px-2 text-sm font-normal text-ink">
            <option value="">{t("allSeniorities")}</option>
            {seniorities.map((seniority) => <option key={seniority} value={seniority}>{seniority}</option>)}
          </select>
        </label>
      </div>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-stone-200 bg-paper/60 text-micro font-semibold uppercase tracking-wide text-steel">
            <th scope="col" className="px-3 py-2">{t("colAssignment")}</th>
            <th scope="col" className="hidden px-3 py-2 md:table-cell">{t("colRole")}</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("colSeniority")}</th>
            <th scope="col" className="px-3 py-2">{t("colStage")}</th>
            <th scope="col" className="hidden px-3 py-2 sm:table-cell">{t("colSubmissions")}</th>
            <th scope="col" className="hidden px-3 py-2 lg:table-cell">{t("colCreated")}</th>
            <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">{t("open")}</span></th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c, i) => {
            const stage = c.stage;
            const submissions = c.submissionCount;
            const stall = stallForCase(
              {
                stage,
                updatedAt: c.lifecycleUpdatedAt,
                createdAt: c.lifecycleCreatedAt ?? c.createdAt,
                submissionCount: submissions,
              },
              nowMs,
            );
            return (
              <tr
                key={c.id}
                onClick={() => onOpen(c.id)}
                style={{ animationDelay: `${i * 30}ms` }}
                className="animate-fade-in cursor-pointer border-b border-stone-100 transition-colors last:border-b-0 hover:bg-paper/50 motion-reduce:animate-none"
              >
                <td className="max-w-0 px-3 py-2.5">
                  {/* the focusable element for keyboard users — the whole row stays clickable for pointers */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(c.id);
                    }}
                    className="focus-ring block w-full truncate rounded text-left text-base font-semibold text-ink hover:text-coral"
                  >
                    {c.title || t("untitledAssignment")}
                  </button>
                  <p className="truncate text-micro text-steel md:hidden">{c.roleTitle}</p>
                </td>
                <td className="hidden max-w-0 truncate px-3 py-2.5 text-sm text-ink md:table-cell">{c.roleTitle ?? "—"}</td>
                <td className="hidden px-3 py-2.5 text-sm uppercase text-steel sm:table-cell">{c.seniority ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip
                      tone={assignmentStageTone(stage)}
                      label={stageLabel(stage)}
                      ariaLabel={t("stageAria", { stage: stageLabel(stage) })}
                      className="uppercase"
                    />
                    {stall.stalled ? (
                      <span
                        title={tLife("stalledTitle", { days: stall.ageDays ?? 0 })}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-micro font-semibold uppercase text-coral"
                      >
                        <AlarmClock size={11} aria-hidden /> {tLife("stalledBadge", { days: stall.ageDays ?? 0 })}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-3 py-2.5 text-sm nums text-ink sm:table-cell">{submissions > 0 ? submissions : "—"}</td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-sm text-steel lg:table-cell">{rel(c.createdAt)}</td>
                <td className="px-2 py-2.5 text-steel"><ChevronRight size={15} aria-hidden /></td>
              </tr>
            );
          })}
          {cases.length === 0 ? (
            <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-steel">{t("noMatches")}</td></tr>
          ) : null}
        </tbody>
      </table>
      {/* ONE THREAD (gap 8) — the legend lives here because this is the axis with
          TEN values: the reader most needs to be told that "designed" and
          "collecting" are the same kind of state, and that "awaiting approval" is
          the one that is about them. Same component, same five words, on every
          surface that carries a status chip. */}
      {truncated ? (
        <div className={`${DIVIDER} flex flex-wrap items-center gap-2 bg-paper/40 px-3 py-2`}>
          <p role="status" className="text-micro text-steel">
            {t("truncated", { count: cases.length })}
          </p>
          {onLoadMore ? (
            <button
              type="button"
              onClick={onLoadMore}
              className="focus-ring inline-flex h-7 items-center rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-ink hover:border-coral/40"
            >
              {t("loadMore")}
            </button>
          ) : null}
        </div>
      ) : null}
      <StatusLegend className={`${DIVIDER} bg-paper/40 px-3 py-2`} />
    </div>
  );
}
