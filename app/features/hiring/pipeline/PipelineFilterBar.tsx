"use client";

// The Positions board's HEADER — the chrome that belongs to the board, rendered as
// the board panel's own top layer rather than as a free-floating strip.
//
// It used to sit several blocks above the thing it filtered: the degraded and
// approvals banners, the bulk-action bar, the SLA editor and the saved-views row all
// rendered BETWEEN this bar and the first candidate card, so the search box and the
// board were rarely on screen together and the connection between them had to be
// remembered rather than seen. Now the title, the search, the facets and the modes
// are one attached header, and the first lane starts immediately under it.
//
// Two rows, split by WHAT THEY DO rather than by control type:
//   1. narrowing   — board identity, free text, and the four facet dropdowns
//                    (State / Score / Source / Sort). One row, no wrap in practice.
//   2. the result  — how much of the board survived, and the actions you take on
//                    that result: clear, save it as a view, select from it, tune
//                    the aging thresholds behind it.
//
// Row 1 held all of it before — count, Save view, Select and Aging SLAs elbowing the
// search box, plus fifteen always-visible facet chips stacked underneath (see
// PipelineFilterMenu for why those became dropdowns). Everything that is about the
// OUTCOME of filtering now lives on its own quiet row, so the primary row stays a
// stable, un-jumping line of controls whatever the filter state.
//
// Pure display + callbacks, no state of its own.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { BookmarkPlus, CheckSquare, Timer, AlertTriangle } from "lucide-react";
import { TextInput } from "@/app/_components/TextInput";
import { PipelineFilterMenu, type FilterMenuOption } from "./PipelineFilterMenu";
import { FadeInline } from "./PipelineMotion";
import type { QuickFilter, ScoreBandKey, SortKey } from "./pipelineBoardFilters";
import type { StageFilterResolution } from "./usePipelineFilters";

// The deep-linked funnel-stage filter (ANA1) rides INSIDE the State menu as an
// already-checked row rather than as a floating chip: it is a state facet, it can
// only ever be cleared (nothing in the UI mints one), and unchecking it is exactly
// that. Prefixed so it can never collide with a QuickFilter key.
const STAGE_OPTION = "__stage";

export function PipelineFilterBar({
  t,
  enumLabel,
  query,
  onQueryChange,
  quicks,
  onToggleQuick,
  stageFilter,
  stageResolved,
  onClearStage,
  filtering,
  shownCount,
  totalCount,
  activeViewId,
  onSaveView,
  selectMode,
  onToggleSelectMode,
  editingSla,
  onToggleSlaEditor,
  scoreBands,
  onToggleBand,
  scoreBandKeys,
  sourceValues,
  sources,
  onToggleSource,
  channelName,
  sort,
  onSortChange,
  onClearFilters,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  query: string;
  onQueryChange: (value: string) => void;
  quicks: ReadonlySet<QuickFilter>;
  onToggleQuick: (f: QuickFilter) => void;
  stageFilter: string | null;
  /** UAT TOM-ANA-11 — the deep-linked stage resolved against the WORKSPACE's board
   *  columns, or null while that axis is still in flight (the board fetch carries it).
   *  Null means "not known yet", never "not on the board": a notice must not flash
   *  during the load and then retract itself. */
  stageResolved: StageFilterResolution | null;
  onClearStage: () => void;
  filtering: boolean;
  shownCount: number;
  totalCount: number;
  activeViewId: string | null;
  onSaveView: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  editingSla: boolean;
  onToggleSlaEditor: () => void;
  scoreBands: ReadonlySet<ScoreBandKey>;
  onToggleBand: (b: ScoreBandKey) => void;
  scoreBandKeys: readonly ScoreBandKey[];
  sourceValues: string[];
  sources: ReadonlySet<string>;
  onToggleSource: (s: string) => void;
  channelName: (channel: string) => string;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onClearFilters: () => void;
}) {
  const modeBtn = (active: boolean): string =>
    `focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-base font-semibold transition-colors ${
      active ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
    }`;

  // UAT TOM-ANA-11 — the workspace's OWN label for the column wins (Settings → Hiring
  // renames labels, never ids), falling back to the enum catalog while the axis is in
  // flight and to the raw id for a stage no axis can name.
  const stageText = stageFilter ? stageResolved?.label || enumLabel("stage", stageFilter) : "";
  // Definite, not merely unknown: only once the axis has arrived (stageResolved != null)
  // can the board say a stage is not one of its columns.
  const stageOffBoard = Boolean(stageFilter) && stageResolved != null && !stageResolved.onBoard;

  const stateOptions: FilterMenuOption[] = [
    { value: "interview", label: t("filterInterview") },
    { value: "aging", label: t("filterAging") },
    { value: "awaiting", label: t("filterAwaiting") },
    { value: "intake", label: t("filterIntake") },
    ...(stageFilter ? [{ value: STAGE_OPTION, label: t("filterStage", { stage: stageText }) }] : []),
  ];
  const stateSelected = [...quicks, ...(stageFilter ? [STAGE_OPTION] : [])];

  const scoreOptions: FilterMenuOption[] = scoreBandKeys.map((b) => ({
    value: b,
    label: t(
      b === "strong" ? "filterScoreStrong" : b === "mid" ? "filterScoreMid" : b === "weak" ? "filterScoreWeak" : "filterScoreUnscored"
    ),
  }));

  const sortOptions: FilterMenuOption[] = [
    { value: "insertion", label: t("sortInsertion") },
    { value: "score", label: t("sortScore") },
    { value: "age", label: t("sortAge") },
  ];

  return (
    <div className="border-b border-stone-200">
      {/* ── Row 1: what board this is, who I'm looking for, how it's narrowed ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h3 className="text-meta uppercase tracking-wide text-steel">{t("statPositions")}</h3>
        <label htmlFor="pipeline-search" className="sr-only">{t("searchLabel")}</label>
        <TextInput
          id="pipeline-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="min-w-[200px] max-w-sm flex-1"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PipelineFilterMenu
            label={t("filterStateLabel")}
            options={stateOptions}
            selected={stateSelected}
            multiple
            onSelect={(v) => (v === STAGE_OPTION ? onClearStage() : onToggleQuick(v as QuickFilter))}
          />
          <PipelineFilterMenu
            label={t("filterScoreLabel")}
            options={scoreOptions}
            selected={[...scoreBands]}
            multiple
            onSelect={(v) => onToggleBand(v as ScoreBandKey)}
          />
          {/* Only when the board actually spans more than one channel — a single-source
              board would offer a menu that can never narrow anything. */}
          {sourceValues.length > 1 ? (
            <PipelineFilterMenu
              label={t("filterSourceLabel")}
              options={sourceValues.map((s) => ({ value: s, label: channelName(s) }))}
              selected={[...sources]}
              multiple
              onSelect={onToggleSource}
            />
          ) : null}
          <PipelineFilterMenu
            label={t("sortLabel")}
            options={sortOptions}
            selected={[sort]}
            onSelect={(v) => onSortChange(v as SortKey)}
          />
        </div>
      </div>

      {/* ── Row 2: the result of all that, and what you do with it ── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 bg-paper px-4 py-2">
        {/* The live count belongs WITH the outcome, not wedged against the title:
            "of how many" is a question about the filtered board. */}
        <FadeInline show={filtering}>
          <span className="text-base text-steel" aria-live="polite">
            {t("showingCount", { shown: shownCount, total: totalCount })}
          </span>
        </FadeInline>
        <FadeInline show={filtering}>
          <button
            type="button"
            onClick={onClearFilters}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-3 py-1 text-base font-semibold text-coral transition-colors hover:bg-coral/10"
          >
            {t("clear")}
          </button>
        </FadeInline>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* PIPE5: save the current combo as a named view (only when it isn't
              already one). */}
          <FadeInline show={filtering && !activeViewId}>
            <button type="button" onClick={onSaveView} className={modeBtn(false)}>
              <BookmarkPlus size={14} aria-hidden /> {t("saveView")}
            </button>
          </FadeInline>
          {/* PIPE1: flip the board's rows into checkboxes for batch actions. */}
          <button type="button" onClick={onToggleSelectMode} aria-pressed={selectMode} className={modeBtn(selectMode)}>
            <CheckSquare size={14} aria-hidden /> {selectMode ? t("selectDone") : t("select")}
          </button>
          {/* PIPE4: tune the per-stage aging thresholds for this board. */}
          <button
            type="button"
            onClick={onToggleSlaEditor}
            aria-pressed={editingSla}
            title={t("agingSlasTitle")}
            className={modeBtn(editingSla)}
          >
            <Timer size={14} aria-hidden /> {t("agingSlas")}
          </button>
        </div>
      </div>

      {/* ── UAT TOM-ANA-11: the stage this link points at is not a column here ── */}
      {/* Sits directly above the lanes, because it exists to explain what they are
          showing. The alternative the board used to take — drop the filter and render
          everything — is the silent failure the finding is about: an unfiltered board
          looks exactly like a board where nothing was filtered out, so a stale drill-down
          silently answered a different question than the one asked. The stage stays
          APPLIED (candidates still standing on a dropped column surface in the off-axis
          strip below, which is precisely what the link was pointing at); this says why
          there is no column for them, and offers the one-click way out. */}
      {stageOffBoard ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-amber-300 bg-amber-50 px-4 py-2 text-base text-amber-900"
        >
          <AlertTriangle size={14} className="shrink-0 text-amber-700" aria-hidden />
          <span>{t("stageOffBoard", { stage: stageText })}</span>
          <button
            type="button"
            onClick={onClearStage}
            className="focus-ring rounded font-semibold text-amber-900 underline underline-offset-2 hover:text-ink"
          >
            {t("stageOffBoardClear")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
