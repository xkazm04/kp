"use client";

import { MatrixLegend } from "./MatrixShared";
import { MatrixEmptyState } from "./MatrixEmptyState";
import { CompletionCta } from "@/app/_components/CompletionCta";
import { MatrixToolbar } from "./MatrixToolbar";
import { MatrixSelectBar } from "./MatrixSelectBar";
import { MatrixFilterRow } from "./MatrixFilterRow";
import { MatrixDataNotices } from "./MatrixDataNotices";
import { MatrixGrid } from "./MatrixGrid";
import { MatrixReasoningPopover } from "./MatrixReasoningPopover";
import { useMatrixTab } from "./useMatrixTab";

export function MatrixTab() {
  const m = useMatrixTab();
  const { t, enumLabel, data, error, cols, rows, scopedPosition, staleJob } = m;

  return (
    <>
    {/* Tier 1 (docs/design/loading-choreography.md): the header, filter/action controls and
        (once the fetch lands) the grid's row/column headers are direct children here —
        none of them sit inside a loading branch. aria-busy covers the first load only;
        a later refresh never blanks what's already on screen. */}
    <section className="stagger-children space-y-4" aria-busy={!data && !error}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
          <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-body text-steel">
            {staleJob
              ? t("introStale")
              : scopedPosition
              ? t("introScoped", { title: scopedPosition.title })
              : t("introDefault")}
          </p>
        </div>
        {!staleJob ? (
          <MatrixToolbar
            data={data}
            rowsLength={rows.length}
            colsLength={cols.length}
            minFit={m.minFit}
            setMinFit={m.setMinFit}
            sortCol={m.sortCol}
            sortByFit={m.sortByFit}
            setSortByFit={m.setSortByFit}
            setSortCol={m.setSortCol}
            selectMode={m.selectMode}
            setSelectMode={m.setSelectMode}
            exitSelect={m.exitSelect}
            exportCsv={m.exportCsv}
            t={t}
          />
        ) : null}
      </header>

      <MatrixDataNotices
        data={data}
        minFit={m.minFit}
        hiddenUnassessed={m.rowOrder.hiddenUnassessed}
        scopedPosition={scopedPosition}
        coverage={m.coverage}
        t={t}
      />

      <p role="status" aria-live="polite" className="sr-only">{m.announce}</p>

      {/* Bulk-add used to complete with no visible trace — say what was filed
          and link to the board where the new entries actually landed. */}
      {m.lastAdd && m.lastAdd.ok > 0 ? (
        <CompletionCta
          message={
            m.lastAdd.failed === 0
              ? t("addedAnnounce", { count: m.lastAdd.ok })
              : t("addedPartial", { ok: m.lastAdd.ok, failed: m.lastAdd.failed })
          }
          links={[{ label: t("addedBannerCta"), tab: "pipeline" }]}
          onDismiss={() => m.setLastAdd(null)}
          dismissLabel={t("addedDismiss")}
        />
      ) : null}

      {m.selectMode ? (
        <MatrixSelectBar
          selectedSize={m.selected.size}
          adding={m.adding}
          addSelected={m.addSelected}
          clearSelected={() => m.setSelected(new Set())}
          exitSelect={m.exitSelect}
          t={t}
        />
      ) : null}

      <MatrixFilterRow
        scopedPositionTitle={scopedPosition?.title ?? null}
        clearJob={m.clearJob}
        staleJob={staleJob}
        families={m.families}
        family={m.family}
        setFamily={m.setFamily}
        enumLabel={enumLabel}
        t={t}
      />

      {error ? (
        <p className="rounded-md bg-red-50 p-3 text-base text-red-700">{error}</p>
      ) : !data ? (
        // Tier 2: the /api/matrix fetch is in flight and there's nothing to show yet.
        // Reserve roughly the grid + legend's height and stay invisible for 150ms so a
        // fast response never flashes a placeholder at all (was two pulsing Skeleton
        // blocks drawing a table nobody was getting).
        <div className="reveal-quiet min-h-[26rem] rounded-lg border border-stone-200 bg-white shadow-panel" aria-hidden />
      ) : staleJob ? (
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center shadow-panel">
          <p className="font-serif text-xl text-ink">{t("staleTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("staleBody")}</p>
          <button
            type="button"
            onClick={m.clearJob}
            className="focus-ring mt-5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            {t("showAll")}
          </button>
        </div>
      ) : data.candidates.length === 0 || data.positions.length === 0 ? (
        // /prototype round 1: the first-run empty state is behind a local variant
        // switcher (baseline is the default, so this load is unchanged).
        <MatrixEmptyState candidateCount={data.candidates.length} positionCount={data.positions.length} />
      ) : rows.length === 0 || cols.length === 0 ? (
        // The dataset has candidates/positions, but the min-fit floor or family filter
        // hid them all — show a recoverable empty state instead of sticky headers over
        // a blank tbody (which read as a broken grid).
        <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center shadow-panel">
          <p className="font-serif text-xl text-ink">{t("filteredEmptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("filteredEmptyBody")}</p>
          <button
            type="button"
            onClick={() => {
              m.setMinFit(0);
              m.setFamily("all");
            }}
            className="focus-ring mt-5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            {t("clearFilters")}
          </button>
        </div>
      ) : (
        <>
          <MatrixGrid
            data={data}
            cols={cols}
            rows={rows}
            colScores={m.colScores}
            rowStrong={m.rowStrong}
            sortCol={m.sortCol}
            setSortCol={m.setSortCol}
            selectMode={m.selectMode}
            selected={m.selected}
            toggleCell={m.toggleCell}
            openCell={m.openCell}
            added={m.added}
            t={t}
            enumLabel={enumLabel}
            blockedLabel={m.blockedLabel}
          />
          <MatrixLegend />
        </>
      )}
    </section>

      {m.popover ? (
        <MatrixReasoningPopover
          popover={m.popover}
          reasoning={m.reasoning}
          t={t}
          blockedLabel={m.blockedLabel}
          closePopover={m.closePopover}
          dialogRef={m.dialogRef}
          onViewFullMatch={() => {
            const p = m.popover!;
            m.viewFullMatchAndClose(p.candId, p.posId);
          }}
        />
      ) : null}
    </>
  );
}
