"use client";

import { useLocale, useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import { scoreTone, type ScoreTone } from "@/app/_lib/format";

/** The canonical score tiers (format.ts scoreTone), as the fill of a score bar. */
const BAR: Record<ScoreTone, string> = {
  strong: "bg-score-strong",
  mid: "bg-score-mid",
  weak: "bg-score-weak",
  null: "bg-score-null",
};

/** A match score as the board prints it (a whole percent), or a dash with its reason. */
export function ScoreFig({ score }: { score: number | null }) {
  const t = useTranslations("one.core.panels");
  const locale = useLocale();
  if (score === null) {
    return (
      <span data-tip={t("noScore")} tabIndex={0}>
        {ABSENT}
      </span>
    );
  }
  return <span className="k-nums">{new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(score / 100)}</span>;
}

/** The score as a right-aligned tabular figure with a small bar after it — the bar is
 *  the same tier the board uses, never a second scale. A missing score is a dash, no bar. */
export function ScoreBar({ score }: { score: number | null }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="w-10 text-right">
        <ScoreFig score={score} />
      </span>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-stone-200" aria-hidden data-score-bar>
        {score === null ? null : <span className={`block h-full rounded-full ${BAR[scoreTone(score)]}`} style={{ width: `${pct}%` }} />}
      </span>
    </span>
  );
}
