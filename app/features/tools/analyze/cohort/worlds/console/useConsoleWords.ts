"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AbsentReason, CellTier, CohortCell, CohortDimension, CohortMember, ShortLabel } from "../../cohortTypes";

type Values = Record<string, string | number>;
/** A short label's key is DATA (engine output), so it cannot be a typed key: read it loosely. */
type LooseT = (key: string, values?: Values) => string;

export type ConsoleWords = ReturnType<typeof useConsoleWords>;

/**
 * The desk's words: the shared cohort vocabulary (dimension names, short labels, absent reasons)
 * and this world's own (`analyzeCohort.console`), plus the composed accessible names every
 * channel, meter and fader carries. One place, so a meter's name and the readout never disagree.
 */
export function useConsoleWords() {
  const t = useTranslations("analyzeCohort.console");
  const tc = useTranslations("analyzeCohort");
  const locale = useLocale();
  return useMemo(() => {
    const loose = tc as unknown as LooseT;
    const dim = (d: CohortDimension) => tc(`dims.${d}`);
    const label = (l: ShortLabel) => loose(`labels.${l.key}`, l.params);
    const absent = (r: AbsentReason | undefined) => tc(`absent.${r ?? "notRead"}`);
    const tier = (x: Exclude<CellTier, "absent">) => t(`tier.${x}`);
    const list = (names: string[]) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(names);
    const cellName = (m: CohortMember, c: CohortCell): string => {
      const base =
        c.tier === "absent" || c.rating == null
          ? t("cell.absent", { name: m.label, dim: dim(c.dimension), reason: absent(c.absentReason) })
          : t("cell.rated", { name: m.label, dim: dim(c.dimension), rating: c.rating, tier: tier(c.tier as Exclude<CellTier, "absent">), label: label(c.label) });
      return c.comment ? `${base} ${t("cell.note", { comment: c.comment })}` : base;
    };
    return { t, dim, label, absent, tier, list, cellName };
  }, [t, tc, locale]);
}
