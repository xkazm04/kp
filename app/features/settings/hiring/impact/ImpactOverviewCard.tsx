"use client";

/*
 * Overview, previewed as a MINIATURE OF THE BOARD.
 *
 * Drawn with the board's own grammar rather than a chip row: ruled columns in
 * board order, uppercase stage headers from the same `enums.stage.*` catalog
 * PipelineBoard renders its headers from, and — for a column this plan runs
 * nothing at — the board's literal empty-cell `·`. The recruiter recognises the
 * destination before reading a word.
 *
 * A column carrying more rounds than the axis has interview stages stacks them
 * (see `deriveImpact`), so the default plan's two rounds in one Interview column
 * show as two chips in one column instead of an invented extra column.
 */
import { useTranslations } from "next-intl";
import type { PlanImpact } from "../pipelineComposerModel";
import { ImpactCard, RoundChip, TONE } from "./impactShared";

export function ImpactOverviewCard({
  stations,
  stationLabel,
}: {
  stations: PlanImpact["overview"];
  stationLabel: (id: string) => string;
}) {
  const t = useTranslations("hiringPlan.impact");
  return (
    <ImpactCard
      tone="overview"
      title={t("overview")}
      sub={t("overviewSub")}
      aside={
        <span className={`nums rounded-full px-2 py-0.5 text-sm font-semibold ${TONE.overview.chip}`}>
          {t("colsN", { count: stations.length })}
        </span>
      }
    >
      <div className="-mx-1 overflow-x-auto">
        <div className="grid min-w-max" style={{ gridTemplateColumns: `repeat(${stations.length}, minmax(5.5rem, 1fr))` }}>
          {stations.map((station) => (
            <div key={station.stageId} className="border-r border-stone-200 px-1.5 last:border-r-0">
              <p
                className={`truncate text-meta uppercase ${
                  station.role === "terminal" ? "text-moss" : station.rounds.length > 0 ? "text-ink" : "text-steel"
                }`}
                title={stationLabel(station.stageId)}
              >
                {stationLabel(station.stageId)}
              </p>
              <div className="mt-2 flex min-h-16 flex-col items-start gap-1">
                {station.rounds.length > 0 ? (
                  station.rounds.map((kind, i) => <RoundChip key={i} kind={kind} dense />)
                ) : (
                  <span className="text-h2 leading-none text-stone-300" aria-label={t("noRounds")}>
                    ·
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </ImpactCard>
  );
}
