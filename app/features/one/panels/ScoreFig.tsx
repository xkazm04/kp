"use client";

import { useLocale, useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";

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
