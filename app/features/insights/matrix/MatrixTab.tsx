"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { RotateCw, X } from "lucide-react";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useShellNavigate } from "@/app/features/shell/nav/shallow-nav";
import { buildUrl } from "@/app/features/shell/tabs";
import { MatrixCandidateFocus } from "./focus/MatrixCandidateFocus";
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
import { deriveMatrixMode, pickGridState, type MatrixMode, type MatrixModeOverride } from "./matrixTabState";
import { BTN_PRIMARY, BTN_SECONDARY, PANEL } from "@/app/_components/ui/recipes";

export function MatrixTab() {
  const m = useMatrixTab();
  const { t, data, error, cols, rows, scopedPosition, staleJob } = m;
  const search = useSearchParams();
  const nav = useShellNavigate();
  const reduced = useReducedMotion();

  // Two readings of one question, not two features (see MatrixCandidateFocus): the
  // GRID is pool-first (every candidate × every open role), CANDIDATE FOCUS is
  // candidate-first (one candidate, every role ranked, with weights and reasoning).
  //
  // The URL is the source of truth for which one is showing, because the mode is
  // reachable from outside this component: a roster row's "Match", the pipeline
  // drawer, the command palette and a cell's own "View full match" all arrive as
  // ?profile=<id> (or ?analysis=<slug>), and every one of them used to land on a
  // separate tab. Deriving from the param — rather than mirroring it into state on
  // mount — is what makes a SECOND such navigation, while this tab is already open,
  // switch the mode too.
  const focusParam = search.get("profile") ?? search.get("analysis");
  // The manual toggle is stamped with the param it was made AGAINST, so a later
  // ?profile= arrival expires it automatically. That expiry is what makes clicking
  // a second cell's "View full match" work after the reader has toggled back to the
  // grid — and stamping beats an effect that resets the override, which would set
  // state during render and cascade an extra pass.
  const [override, setOverride] = useState<MatrixModeOverride | null>(null);
  // The rule itself lives in the pure, tested `deriveMatrixMode` — the override-expiry
  // stamp is the subtlest logic in this tab and it had no test.
  const mode: MatrixMode = deriveMatrixMode(focusParam, override);

  const selectMode = (next: MatrixMode) => {
    // Leaving focus drops the candidate selection from the URL — otherwise the grid
    // would sit there holding a ?profile= that reads as "focus is showing".
    if (next === "grid" && focusParam) {
      nav.replace(buildUrl({ profile: null, analysis: null }, search.toString()));
      setOverride({ mode: next, forParam: null });
      return;
    }
    setOverride({ mode: next, forParam: focusParam });
  };

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
            {mode === "focus"
              ? t("introFocus")
              : staleJob
              ? t("introStale")
              : scopedPosition
              ? t("introScoped", { title: scopedPosition.title })
              : t("introDefault")}
          </p>
        </div>
        {/* The grid's filter/sort/export controls belong to the grid alone — focus
            mode carries its own picker and weights panel. */}
        {!staleJob && mode === "grid" ? (
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

      <SegmentedControl
        label={t("modeLabel")}
        value={mode}
        onChange={selectMode}
        options={[
          { value: "grid", label: t("modeGrid") },
          { value: "focus", label: t("modeFocus") },
        ]}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.18, ease: "easeOut" }}
          className="space-y-4"
        >
          {mode === "focus" ? <MatrixCandidateFocus /> : <MatrixGridView m={m} />}
        </motion.div>
      </AnimatePresence>
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

// The grid half of the tab: notices, select bar, family filter and the grid itself.
// Extracted so the mode switch above reads as one line per mode, and so the whole
// grid subtree unmounts in focus mode rather than sitting hidden behind a CSS toggle.
function MatrixGridView({ m }: { m: ReturnType<typeof useMatrixTab> }) {
  const { t, enumLabel, data, error, cols, rows, scopedPosition, staleJob } = m;
  // The six-way branch below used to be a chain of nested ternaries in JSX; the ORDER is
  // the contract (an error outranks a stale ?job=, a stale job outranks an empty pool)
  // and nothing could assert against it. Now it is one tested pure function.
  const state = pickGridState({
    hasError: Boolean(error),
    hasData: Boolean(data),
    staleJob,
    candidateCount: data?.candidates.length ?? 0,
    positionCount: data?.positions.length ?? 0,
    rowCount: rows.length,
    colCount: cols.length,
  });
  return (
    <>
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

      {/* …and when EVERY row failed there is no success to report, so the band above stays
          hidden and the only account of the failure was the sr-only live region: a sighted
          recruiter saw the button re-enable, the ticks still there, and nothing else — the
          same "silent" outcome the band was added to kill. Say it plainly, in the failure
          register (nothing landed, so no board link to offer). */}
      {m.lastAdd && m.lastAdd.ok === 0 && m.lastAdd.failed > 0 ? (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          <span>{t("addedPartial", { ok: 0, failed: m.lastAdd.failed })}</span>
          <button
            type="button"
            onClick={() => m.setLastAdd(null)}
            aria-label={t("addedDismiss")}
            className="focus-ring shrink-0 rounded p-0.5 hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        </p>
      ) : null}

      {m.selectMode ? (
        <MatrixSelectBar
          selectedSize={m.selected.size}
          selectedOutsideCount={m.selectedOutsideCount}
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

      {state === "error" ? (
        // matrix-answers-with-codes-and-retries (b): the failure used to be a bare red
        // line and a dead end — no way back short of reloading the page. `error` is
        // already resolved from the response's machine `code` (useErrorMessage), so the
        // sentence is the real cause in the reader's language; the button is the way out.
        <div role="alert" className={`${PANEL} space-y-3 p-5`}>
          <p className="text-base text-red-700">{error}</p>
          <button type="button" onClick={m.retryLoad} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
            <RotateCw size={14} aria-hidden /> {t("retryLoad")}
          </button>
        </div>
      ) : state === "loading" ? (
        // Tier 2: the /api/matrix fetch is in flight and there's nothing to show yet.
        // Reserve roughly the grid + legend's height and stay invisible for 150ms so a
        // fast response never flashes a placeholder at all (was two pulsing Skeleton
        // blocks drawing a table nobody was getting).
        <div className={`reveal-quiet min-h-[26rem] ${PANEL}`} aria-hidden />
      ) : state === "stale" ? (
        <div className={`${PANEL} bg-paper p-8 text-center`}>
          <p className="font-serif text-xl text-ink">{t("staleTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("staleBody")}</p>
          <button type="button" onClick={m.clearJob} className={`${BTN_PRIMARY} mt-5 h-10 px-4 text-sm`}>
            {t("showAll")}
          </button>
        </div>
      ) : state === "empty" ? (
        <MatrixEmptyState candidateCount={data!.candidates.length} positionCount={data!.positions.length} />
      ) : state === "filtered" ? (
        // The dataset has candidates/positions, but the min-fit floor or family filter
        // hid them all — show a recoverable empty state instead of sticky headers over
        // a blank tbody (which read as a broken grid).
        <div className={`${PANEL} bg-paper p-8 text-center`}>
          <p className="font-serif text-xl text-ink">{t("filteredEmptyTitle")}</p>
          <p className="mx-auto mt-2 max-w-md text-base text-steel">{t("filteredEmptyBody")}</p>
          <button
            type="button"
            onClick={() => {
              m.setMinFit(0);
              m.setFamily("all");
            }}
            className={`${BTN_PRIMARY} mt-5 h-10 px-4 text-sm`}
          >
            {t("clearFilters")}
          </button>
        </div>
      ) : (
        <>
          {/* `state === "grid"` already means data is present (pickGridState answers
              "loading" otherwise); TS cannot see through the pure helper. */}
          <MatrixGrid
            data={data!}
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
    </>
  );
}
