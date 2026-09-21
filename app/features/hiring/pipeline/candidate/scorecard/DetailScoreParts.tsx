"use client";

// The score half of the Scorecard: the big figure, a 0–100 meter with the
// confidence range behind the marker, and the weighted breakdown table.

import { useTranslations } from "next-intl";
import { clampPercent, scoreTone } from "@/app/_lib/format";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { Skeleton } from "@/app/_components/Skeleton";
import { TONE_BAR, TONE_TEXT } from "@/app/features/hiring/pipeline/map/mapTone";
import type { CandidateDetailModel } from "./candidateDetailModel";

const NS = "pipeline.candidate.scorecard";
const FIGURE_SIZE = { lg: "text-5xl", xl: "text-6xl" } as const;

export function ScoreFigure({
  model,
  size = "lg",
  caption,
  detail,
}: {
  model: CandidateDetailModel;
  size?: keyof typeof FIGURE_SIZE;
  /** What the number is ("Score", "transfer"). */
  caption: string;
  /** Where it came from (provenance), when known. */
  detail?: string | null;
}) {
  const t = useTranslations(NS);
  return (
    <p className="flex flex-col gap-1">
      <span className={`nums font-serif leading-none ${FIGURE_SIZE[size]} ${TONE_TEXT[model.tone]}`}>
        {model.score ?? "—"}
      </span>
      <span className={META_LABEL}>{model.score == null ? t("unscored") : caption}</span>
      {detail && model.score != null ? <span className="text-sm leading-tight text-steel">{detail}</span> : null}
    </p>
  );
}

/** 0–100 track; the confidence band sits behind the score marker, so "82, likely
 *  74–88" reads as one shape. */
export function ScoreMeter({ model }: { model: CandidateDetailModel }) {
  const t = useTranslations(NS);
  if (model.score == null) return null;
  const c = model.confidence;
  const low = c ? clampPercent(c.low) : null;
  const high = c ? clampPercent(c.high) : null;
  return (
    <div className="w-full">
      <div className="relative h-2 w-full rounded-full bg-stone-100" aria-hidden="true">
        {low != null && high != null ? (
          <span
            className="absolute inset-y-0 rounded-full bg-stone-300"
            style={{ left: `${low}%`, width: `${Math.max(1, high - low)}%` }}
          />
        ) : null}
        <span
          className={`absolute -top-1 h-4 w-1.5 -translate-x-1/2 rounded-full ${TONE_BAR[model.tone]}`}
          style={{ left: `${model.score}%` }}
        />
      </div>
      {low != null && high != null ? (
        <p className={`mt-2 ${META_LABEL}`}>{t("confidence", { low: Math.round(low), high: Math.round(high) })}</p>
      ) : null}
    </div>
  );
}

/** Dimension · bar · weight · points — the full arithmetic behind the total. */
export function BreakdownTable({ model, loading }: { model: CandidateDetailModel; loading: boolean }) {
  const t = useTranslations(NS);
  if (loading) {
    return (
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-5 w-full rounded" />
        ))}
      </div>
    );
  }
  if (model.dims.length === 0) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left">
          <th scope="col" className={`${META_LABEL} pb-2 font-normal`}>
            {t("breakdown")}
          </th>
          <th scope="col" className="sr-only">
            {t("score")}
          </th>
          <th scope="col" className={`${META_LABEL} pb-2 text-right font-normal`}>
            {t("weight")}
          </th>
          <th scope="col" className={`${META_LABEL} pb-2 pl-3 text-right font-normal`}>
            {t("points")}
          </th>
        </tr>
      </thead>
      <tbody>
        {model.dims.map((d) => {
          const pct = clampPercent(d.percent);
          return (
            <tr key={d.key} className="border-t border-stone-200">
              <td className="py-2 pr-3 text-ink">{d.label || d.key}</td>
              <td className="w-1/2 py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span className="block h-2 flex-1 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${TONE_BAR[scoreTone(pct)]}`}
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </span>
                  <span className="nums w-8 text-right font-semibold text-ink">{Math.round(pct)}</span>
                </span>
              </td>
              <td className="nums py-2 text-right text-steel">{Math.round(d.weight)}%</td>
              <td className="nums py-2 pl-3 text-right text-steel">+{Math.round(d.contribution)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
