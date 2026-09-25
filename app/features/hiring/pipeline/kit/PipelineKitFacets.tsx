"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChipRow, Mark, type Chip } from "@/app/_components/kit";
import { Menu, type MenuOption } from "@/app/_components/kit/Menu";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { SCORE_BANDS, type QuickFilter, type ScoreBandKey, type SortKey } from "../pipelineBoardFilters";
import { resolveStageFilter } from "../usePipelineFilters";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { OUT } from "./pipelineKitModel";

// The deep-linked stage filter rides INSIDE the State facet as an already-checked option: it can only
// ever be cleared (nothing in the view mints one), and unchecking it is exactly that.
const STAGE_OPTION = "__stage";
const BAND_KEY = { strong: "filterScoreStrong", mid: "filterScoreMid", weak: "filterScoreWeak", unscored: "filterScoreUnscored" } as const;

/**
 * The toolbar's filter line: the retired board's four facets (State, Score, Source, Sort) as kit
 * Menus, then the chips (waiting on you, needs intake, the picked layer, the brushed range, Clear).
 * The facets read and write the URL-synced filter state (usePipelineFilters), so a deep link from
 * Analytics (?stage= / ?quick= / ?band= / ?source= / ?sort=) lands pre-filtered and a saved view
 * round-trips.
 */
export function PipelineKitFacets({ s, k }: { s: PipelineTabState; k: PipelineKit }) {
  const t = useTranslations("pipeline.kit");
  const tt = useTranslations("pipeline.tab");
  const locale = useLocale();
  const enumLabel = useEnumLabel();
  const byLabel = (a: MenuOption, b: MenuOption) => a.label.localeCompare(b.label, locale);
  const resolved = s.stageFilter && s.entries != null ? resolveStageFilter(s.stageFilter, s.axis, s.retiredStages) : null;
  const stageText = s.stageFilter ? resolved?.label || enumLabel("stage", s.stageFilter) : "";

  const stateOptions: MenuOption[] = [
    { value: "active", label: tt("statActive") },
    { value: "interview", label: tt("filterInterview") },
    { value: "aging", label: tt("filterAging") },
    { value: "awaiting", label: tt("filterAwaiting") },
    { value: "intake", label: tt("filterIntake") },
    ...(s.stageFilter ? [{ value: STAGE_OPTION, label: tt("filterStage", { stage: stageText }) }] : []),
  ].sort(byLabel);
  const scoreOptions: MenuOption[] = SCORE_BANDS.map((b) => ({ value: b, label: tt(BAND_KEY[b]) }));
  // Every source on the board UNION every selected one: a shared link can name a channel the board
  // no longer carries, and the facet doing the filtering must still show it (and let it be cleared).
  const sourceOptions: MenuOption[] = [...new Set([...s.sourceValues, ...s.sources])].map((v) => ({ value: v, label: s.channelName(v) })).sort(byLabel);
  const sortOptions: MenuOption[] = [
    { value: "insertion", label: t("sortKit") },
    { value: "score", label: tt("sortScore") },
    { value: "age", label: tt("sortAge") },
  ];

  const waiting = s.approvals.length;
  const layerLabel = k.layer === OUT ? t("outLabel") : k.layers.find((l) => l.id === k.layer)?.label ?? k.layer ?? "";
  // The level (the roles board or a scope under it) is not a filter: Clear keeps it.
  const narrowed = s.filtering || k.layer != null || k.brush != null || k.needsOnly;
  const chips: Chip[] = [
    { id: "needs", label: t("chipWaiting"), count: waiting, mark: <Mark kind="needs" />, pressed: k.needsOnly, disabled: waiting === 0 && !k.needsOnly, onPress: k.toggleNeeds },
    ...(s.degradedCount > 0 || s.quicks.has("intake")
      ? [{ id: "intake", label: tt("filterIntake"), count: s.degradedCount, mark: <Mark kind="caution" />, pressed: s.quicks.has("intake"), tip: t("intakeTip"), onPress: () => s.toggleQuick("intake") }]
      : []),
    ...(k.layer ? [{ id: "layer", label: t("chipClear", { what: layerLabel }), pressed: true, onPress: k.clearLayer }] : []),
    ...(k.brush ? [{ id: "brush", label: t("chipBrush", { from: k.brush[0] + 1, to: k.brush[1] + 1 }), pressed: true, onPress: () => k.setBrush(null) }] : []),
    ...(narrowed ? [{ id: "clear", label: tt("clearFilters"), onPress: () => { s.clearFilters(); k.clearKitFilters(); } }] : []),
  ];

  return (
    <>
      <Menu
        label={tt("filterStateLabel")}
        options={stateOptions}
        selected={[...s.quicks, ...(s.stageFilter ? [STAGE_OPTION] : [])]}
        multiple
        size="sm"
        onSelect={(v) => (v === STAGE_OPTION ? s.clearStageFilter() : s.toggleQuick(v as QuickFilter))}
      />
      <Menu label={tt("filterScoreLabel")} options={scoreOptions} selected={[...s.scoreBands]} multiple size="sm" onSelect={(v) => s.toggleBand(v as ScoreBandKey)} />
      {/* Only when the board spans more than one channel, or a source filter is already on (it is
          narrowing, and this facet is the only place it can be seen and cleared). */}
      {sourceOptions.length > 1 || s.sources.size > 0 ? (
        <Menu label={tt("filterSourceLabel")} options={sourceOptions} selected={[...s.sources]} multiple size="sm" onSelect={s.toggleSource} />
      ) : null}
      <Menu label={tt("sortLabel")} options={sortOptions} selected={[s.sort]} size="sm" onSelect={(v) => s.setSortAndSync(v as SortKey)} />
      <ChipRow chips={chips} />
    </>
  );
}
