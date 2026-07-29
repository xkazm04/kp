"use client";

// The pipeline board's filter chrome: the search box, quick-filter chips, the
// deep-link-only stage pill, save-view / select-mode / SLA-editor toggles, plus
// the score/source facet rows and the within-lane sort control. Split out of
// PipelineTab.tsx — pure display + callbacks, no state of its own.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { BookmarkPlus, CheckSquare, Timer } from "lucide-react";
import { TextInput } from "@/app/_components/TextInput";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import { PipelineFacetRow } from "./PipelineFacetRow";
import type { QuickFilter, ScoreBandKey, SortKey } from "./pipelineBoardFilters";

export function PipelineFilterBar({
  t,
  enumLabel,
  query,
  onQueryChange,
  quicks,
  onToggleQuick,
  stageFilter,
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
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="pipeline-search" className="sr-only">{t("searchLabel")}</label>
        <TextInput
          id="pipeline-search"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          sizeVariant="sm"
          className="min-w-[200px] flex-1"
        />
        {(
          [
            ["interview", t("filterInterview")],
            ["aging", t("filterAging")],
            ["awaiting", t("filterAwaiting")],
            ["intake", t("filterIntake")],
          ] as [QuickFilter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => onToggleQuick(f)}
            aria-pressed={quicks.has(f)}
            className={CHIP_TOGGLE(quicks.has(f))}
          >
            {label}
          </button>
        ))}
        {/* ANA1: the funnel-stage filter arrives via deep link only; while
            active it reads as a pressed chip that a click dismisses. */}
        {stageFilter ? (
          <button
            type="button"
            onClick={onClearStage}
            aria-pressed={true}
            title={t("filterStageClear")}
            className={CHIP_TOGGLE(true)}
          >
            {t("filterStage", { stage: enumLabel("stage", stageFilter) })} ×
          </button>
        ) : null}
        {filtering ? (
          <span className="text-sm text-steel" aria-live="polite">
            {t("showingCount", { shown: shownCount, total: totalCount })}
          </span>
        ) : null}
        {filtering ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
          >
            {t("clear")}
          </button>
        ) : null}
        {/* PIPE5: save the current combo as a named view (only when it isn't
            already one). */}
        {filtering && !activeViewId ? (
          <button
            type="button"
            onClick={onSaveView}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
          >
            <BookmarkPlus size={13} /> {t("saveView")}
          </button>
        ) : null}
        {/* PIPE1: flip the board's rows into checkboxes for batch actions. */}
        <button
          type="button"
          onClick={onToggleSelectMode}
          aria-pressed={selectMode}
          className={`focus-ring ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
            selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
          }`}
        >
          <CheckSquare size={13} /> {selectMode ? t("selectDone") : t("select")}
        </button>
        {/* PIPE4: tune the per-stage aging thresholds for this board. */}
        <button
          type="button"
          onClick={onToggleSlaEditor}
          aria-pressed={editingSla}
          className={`focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${
            editingSla ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-steel hover:border-coral/40 hover:text-ink"
          }`}
          title={t("agingSlasTitle")}
        >
          <Timer size={13} /> {t("agingSlas")}
        </button>
      </div>

      <PipelineFacetRow
        t={t}
        scoreBands={scoreBands}
        onToggleBand={onToggleBand}
        scoreBandKeys={scoreBandKeys}
        sourceValues={sourceValues}
        sources={sources}
        onToggleSource={onToggleSource}
        channelName={channelName}
        sort={sort}
        onSortChange={onSortChange}
      />
    </>
  );
}
