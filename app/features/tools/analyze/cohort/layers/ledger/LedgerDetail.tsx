"use client";

import { useTranslations } from "next-intl";
import type { CohortDimension, MemberDimensionWhy, ScoreAnatomy } from "../../cohortTypes";
import { anatomySum, criteriaTally, signed } from "./ledgerModel";
import { FullReasons } from "./LedgerReasons";
import { usePhrase } from "./usePhrase";

/**
 * The anatomy as the sum it is: base, then every part signed, then the rating. The engine promises
 * base + parts === raw; the model re-checks it and, if the promise ever broke, the line says the parts
 * do not add up instead of drawing a sum that lies.
 */
function AnatomyLine({ anatomy }: { anatomy: ScoreAnatomy }) {
  const t = useTranslations("analyzeCohort.layerLedger.detail");
  const phrase = usePhrase();
  const s = anatomySum(anatomy);
  return (
    <ol className="lg-sum" aria-label={t("anatomy")}>
      <li className="lg-sum__term lg-sum__term--base">
        <span className="lg-sum__pts k-nums">{s.base}</span>
        <span className="lg-sum__what">{t("base")}</span>
      </li>
      {s.terms.map((p, i) => (
        <li key={i} className="lg-sum__term" data-tone={p.tone} data-zero={p.points === 0 ? "" : undefined}>
          <span className="lg-sum__pts k-nums">{signed(p.points)}</span>
          <span className="lg-sum__what">{phrase(p.phrase)}</span>
        </li>
      ))}
      <li className="lg-sum__term lg-sum__term--total">
        <span className="lg-sum__pts k-nums">= {s.rating}</span>
        <span className="lg-sum__what">{s.clamped ? t("clamped", { raw: s.raw }) : t("rating")}</span>
      </li>
      {s.exact ? null : <li className="lg-sum__broken">{t("inexact")}</li>}
    </ol>
  );
}

/**
 * A row's expansion: every pro, con and note in full (points, source, evidence behind a button), the
 * rating's exact anatomy (or, on fit, the plain statement that the model gives it with no breakdown),
 * and how the member stands on the role's criteria for this dimension.
 */
export function LedgerDetail({ id, why, dimension }: { id: string; why: MemberDimensionWhy; dimension: CohortDimension }) {
  const t = useTranslations("analyzeCohort.layerLedger.detail");
  const tally = criteriaTally(why);
  const criteria = tally.meets + tally.partial + tally.misses + tally.unknown;
  return (
    <div id={id} className="lg-detail">
      <div className="lg-detail__lists">
        <FullReasons tone="pro" list={why.pros} />
        <FullReasons tone="con" list={why.cons} />
        <FullReasons tone="note" list={why.notes} />
      </div>
      <div className="lg-detail__foot">
        <section className="lg-detail__anatomy">
          <h4 className="lg-fulls__h">{t("anatomy")}</h4>
          {why.anatomy ? <AnatomyLine anatomy={why.anatomy} /> : <p className="lg-detail__model">{t(dimension === "fit" ? "modelGiven" : "noAnatomy")}</p>}
        </section>
        {criteria ? (
          <p className="lg-detail__criteria">
            <span className="lg-fulls__h">{t("criteriaTitle")}</span>
            <span className="k-nums">{t("criteria", tally)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
