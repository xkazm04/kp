"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { AbsentReason, CohortCell, CohortDimension, CohortMember, CohortView, ShortLabel } from "../../cohortTypes";
import { knotOf, type RowReading } from "./loomModel";

/**
 * The Loom's words: every user-facing string the world paints comes through here, from
 * `analyzeCohort.loom` (this world's sub-namespace) and the shared `analyzeCohort.{dims,labels,absent}`.
 * Short labels are DATA (a catalog key + ICU params under `analyzeCohort.labels`), so a key the
 * catalog does not know reads as "No rating" rather than leaking a key path.
 */
export function useLoomWords(view: CohortView) {
  const t = useTranslations("analyzeCohort.loom");
  const tc = useTranslations("analyzeCohort");
  const locale = useLocale();
  return useMemo(() => {
    type CKey = Parameters<typeof tc>[0];
    const nameOf = new Map(view.members.map((m) => [m.memberId, m.label]));
    const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
    const dim = (d: CohortDimension) => tc(`dims.${d}`);
    const absent = (r: AbsentReason) => tc(`absent.${r}`);
    const short = (l: ShortLabel): string => {
      const key = `labels.${l.key}` as CKey;
      return tc.has(key) ? tc(key, l.params as never) : tc("labels.none");
    };
    const name = (id: string | null) => (id ? (nameOf.get(id) ?? id) : "");
    const names = (ids: readonly string[]) => list.format(ids.map(name));
    const claim = (r: RowReading): string =>
      r.kind === "clears" ? t("claim.clears", { name: name(r.leader) }) : t(`claim.${r.kind}`);
    const knotName = (m: CohortMember, d: CohortDimension): string => {
      const cell: CohortCell = m.cells[d];
      const k = knotOf(cell);
      if (k.kind === "absent") return t("aria.knotAbsent", { name: m.label, dim: dim(d), reason: absent(k.reason) });
      const args = { name: m.label, dim: dim(d), rating: k.rating, tier: t(`tier.${k.tier}`), label: short(cell.label) };
      return k.comment ? t("aria.knotNote", args) : t("aria.knot", args);
    };
    const tagName = (m: CohortMember): string => {
      const args = { name: m.label, membership: t(`membership.${m.membership}`), state: t(`runState.${m.runState}`) };
      const base = m.analysisSlug ? t("aria.tagReport", args) : t("aria.tag", args);
      return m.decoyOf ? `${base}. ${t("shuttle.slack", { other: name(m.decoyOf) })}` : base;
    };
    return { t, dim, absent, short, name, names, claim, knotName, tagName };
  }, [t, tc, locale, view.members]);
}

export type LoomWords = ReturnType<typeof useLoomWords>;
