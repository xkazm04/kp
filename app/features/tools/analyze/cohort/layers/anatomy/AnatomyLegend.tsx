"use client";

import { useTranslations } from "next-intl";
import type { CohortDimension, CohortMember } from "../../cohortTypes";
import { anatomyGeometry, type SegKind } from "./anatomyModel";
import type { Guide } from "./AnatomyBar";

type Key = SegKind | "rest" | "model";
const ORDER: readonly Key[] = ["base", "earn", "half", "lose", "rest", "model"];

/** The marks this floor actually draws, in reading order (a key nobody on the floor needs is left out). */
function keysOn(order: readonly CohortMember[], d: CohortDimension): Key[] {
  const seen = new Set<Key>();
  for (const m of order) {
    const an = m.why[d]?.anatomy;
    if (!an) {
      if (m.cells[d].rating != null) seen.add("model");
      continue;
    }
    const g = anatomyGeometry(an);
    for (const s of g.segs) seen.add(s.kind);
    if (g.zeroCons.length || Math.max(g.peak, g.rating) < 100) seen.add("rest");
  }
  return ORDER.filter((k) => seen.has(k));
}

/**
 * How to read the bars: a swatch per mark the floor draws, the guide named in the claim's own
 * vocabulary (the leader's rating only where it clears, else the first in order, within the
 * noise), and on fit the plain statement that the model's rating has no point breakdown.
 */
export function AnatomyLegend({ dimension, order, guide, model }: {
  dimension: CohortDimension;
  order: readonly CohortMember[];
  guide: Guide | null;
  model: boolean;
}) {
  const t = useTranslations("analyzeCohort.layerAnatomy.legend");
  const first = order[0];
  return (
    <div className="an-legend">
      {model ? (
        <p className="an-legend__model">
          <strong>{t("modelTitle")}</strong> {t("modelLead")}
        </p>
      ) : null}
      <ul className="an-legend__keys" aria-label={t("label")}>
        {keysOn(order, dimension).map((k) => (
          <li key={k} className="an-legend__key">
            <span className="an-swatch" data-kind={k} aria-hidden />
            {t(k)}
          </li>
        ))}
        {guide && first ? (
          <li className="an-legend__key">
            <span className="an-swatch an-swatch--guide" data-kind={guide.kind} aria-hidden />
            {t(guide.kind === "leader" ? "guideLeader" : "guideFirst", { name: first.label, rating: guide.at })}
          </li>
        ) : null}
        <li className="an-legend__key an-legend__scale k-nums">{t("scale")}</li>
      </ul>
    </div>
  );
}
