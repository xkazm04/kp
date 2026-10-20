"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit/figure";
import type { CohortCell, CohortDimension, CohortMember, CohortView, ShortLabel } from "../../cohortTypes";
import { floorClaimOf, floorLeaderOf, sharesRank } from "./lineupModel";

type Loose = (key: string, values?: Record<string, string | number>) => string;

/**
 * The Line-up's words, in the reader's language. A cell's short label is DATA (a key under
 * `analyzeCohort.labels` plus its ICU values), resolved here once; a key the catalog does not carry
 * falls back to "No rating" rather than printing the key.
 */
export function useLineupWords(view: CohortView) {
  const t = useTranslations("analyzeCohort.lineup");
  const tc = useTranslations("analyzeCohort");
  return useMemo(() => {
    const labels = tc as unknown as Loose & { has: (k: string) => boolean };
    const nameOf = (id: string | null) => view.members.find((m) => m.memberId === id)?.label ?? ABSENT;
    const dim = (d: CohortDimension) => tc(`dims.${d}`);
    const short = (l: ShortLabel) => (labels.has(`labels.${l.key}`) ? labels(`labels.${l.key}`, l.params) : tc("labels.none"));
    const reason = (c: CohortCell) => tc(`absent.${c.absentReason ?? "notRead"}`);
    /** A cell's value in one phrase: its short label, or its absence reason. */
    const value = (c: CohortCell) => (c.rating == null ? reason(c) : short(c.label));
    const rank = (m: CohortMember) =>
      m.fitRank == null ? t("unranked") : sharesRank(view, m) ? t("rankShared", { rank: m.fitRank }) : t("rank", { rank: m.fitRank });
    const house = (m: CohortMember) =>
      m.fitRank == null ? ABSENT : sharesRank(view, m) ? t("houseShared", { rank: m.fitRank }) : t("house", { rank: m.fitRank });
    const claimShort = (d: CohortDimension) => t(`claim.${floorClaimOf(view, d).tone}`);
    const claimLong = (d: CohortDimension) => {
      const c = floorClaimOf(view, d);
      return c.tone === "clears" ? t("claimLong.clears", { name: nameOf(c.leader) }) : t(`claimLong.${c.tone}`, { count: c.partitions });
    };
    /** The accessible name of one floor (or the tower) of one building. */
    const cellName = (m: CohortMember, d: CohortDimension, extras: { haze?: boolean; crown?: boolean } = {}) => {
      const c = m.cells[d];
      const parts = [
        c.rating == null
          ? t("cell.absent", { name: m.label, floor: dim(d), reason: reason(c) })
          : t("cell.rated", { name: m.label, floor: dim(d), label: short(c.label), rating: c.rating }),
      ];
      if (floorLeaderOf(view, d) === m.memberId) parts.push(t("cell.lead"));
      if (extras.crown) parts.push(t("cell.crown"));
      if (extras.haze) parts.push(t("cell.haze"));
      if (d === "fit" && m.decoyOf) parts.push(t("cell.decoy", { name: nameOf(m.decoyOf) }));
      if (c.comment) parts.push(t("cell.comment", { text: c.comment }));
      return parts.join("; ");
    };
    return { t, tc, nameOf, dim, short, reason, value, rank, house, claimShort, claimLong, cellName };
  }, [t, tc, view]);
}

export type LineupWords = ReturnType<typeof useLineupWords>;
