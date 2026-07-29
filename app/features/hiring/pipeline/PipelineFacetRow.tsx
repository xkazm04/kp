"use client";

// perfect-board — the score-band + source facet chips plus the within-lane sort
// control, shown under the main filter row. Split out of PipelineFilterBar.tsx.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { Select } from "@/app/_components/Select";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";
import type { ScoreBandKey, SortKey } from "./pipelineBoardFilters";

export function PipelineFacetRow({
  t,
  scoreBands,
  onToggleBand,
  scoreBandKeys,
  sourceValues,
  sources,
  onToggleSource,
  channelName,
  sort,
  onSortChange,
}: {
  t: PipelineTabTranslator;
  scoreBands: ReadonlySet<ScoreBandKey>;
  onToggleBand: (b: ScoreBandKey) => void;
  scoreBandKeys: readonly ScoreBandKey[];
  sourceValues: string[];
  sources: ReadonlySet<string>;
  onToggleSource: (s: string) => void;
  channelName: (channel: string) => string;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}) {
  return (
    // perfect-board — compound facets the single-select quick row can't express: a
    // score-range band set (honest tiers consistent with the card ScoreBadge;
    // unscored is its own bucket) and, when the board spans more than one channel,
    // a source facet — plus a within-lane sort. Bands + sources compose
    // OR-within / AND-across; every quick chip AND-composes.
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-meta uppercase tracking-wide text-steel">{t("filterScoreLabel")}</span>
        {scoreBandKeys.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onToggleBand(b)}
            aria-pressed={scoreBands.has(b)}
            className={CHIP_TOGGLE(scoreBands.has(b))}
          >
            {t(
              b === "strong"
                ? "filterScoreStrong"
                : b === "mid"
                  ? "filterScoreMid"
                  : b === "weak"
                    ? "filterScoreWeak"
                    : "filterScoreUnscored"
            )}
          </button>
        ))}
      </div>
      {sourceValues.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-meta uppercase tracking-wide text-steel">{t("filterSourceLabel")}</span>
          {sourceValues.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onToggleSource(s)}
              aria-pressed={sources.has(s)}
              className={CHIP_TOGGLE(sources.has(s))}
            >
              {channelName(s)}
            </button>
          ))}
        </div>
      ) : null}
      <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-steel">
        {t("sortLabel")}
        <Select
          ariaLabel={t("sortLabel")}
          value={sort}
          onChange={(v) => onSortChange(v as SortKey)}
          size="sm"
          className="h-8"
          options={[
            { value: "insertion", label: t("sortInsertion") },
            { value: "score", label: t("sortScore") },
            { value: "age", label: t("sortAge") },
          ]}
        />
      </label>
    </div>
  );
}
