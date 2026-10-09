"use client";

import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { CohortDimension, CohortMember, CohortView, Phrase } from "../../cohortTypes";
import { GAP_ROWS, gapBetween, signed, type Rival } from "./anatomyModel";

/**
 * How the candidate in the sheet differs from the one they are measured against, decomposed:
 * the rating gap in words that keep the claim's vocabulary (the LEADER only where the claim
 * clears; otherwise "first in order, within the noise"), then the parts the gap comes from,
 * biggest first, each with both sides' points. The rows sum exactly to the gap. Fit has no
 * parts (model judgement) and says so; salary is never ranked and compares to the band only.
 */
export function AnatomyGap({ view, dimension, member, rival, phrase }: {
  view: CohortView;
  dimension: CohortDimension;
  member: CohortMember;
  rival: Rival;
  phrase: (p: Phrase) => string;
}) {
  const t = useTranslations("analyzeCohort.layerAnatomy.gap");
  if (dimension === "salary") return <p className="an-gap__quiet">{t("salary")}</p>;
  if (!rival) return view.claims.byDimension[dimension].separation === "belowFloor" ? <p className="an-gap__quiet">{t("floor")}</p> : null;
  const mine = member.cells[dimension].rating;
  const theirs = rival.member.cells[dimension].rating;
  if (mine == null || theirs == null) return null;
  const diff = mine - theirs;
  const a = member.why[dimension]?.anatomy;
  const b = rival.member.why[dimension]?.anatomy;
  const gap = a && b ? gapBetween(a, b) : null;
  const shown = gap?.rows.slice(0, GAP_ROWS) ?? [];
  const rest = gap?.rows.slice(GAP_ROWS) ?? [];
  const side = (n: number | null) => (n == null ? ABSENT : signed(n));
  return (
    <section className="an-gap" data-role={rival.role} aria-label={t("label")}>
      <h4 className="an-gap__head">
        {t("headline", { dir: diff < 0 ? "behind" : diff > 0 ? "ahead" : "level", n: Math.abs(diff), name: rival.member.label })}
      </h4>
      <p className="an-gap__role">{t(`role.${rival.role}`)}</p>
      {!gap ? (
        <p className="an-gap__quiet">{t("model")}</p>
      ) : shown.length === 0 ? (
        <p className="an-gap__quiet">{t("same")}</p>
      ) : (
        <>
          <p className="an-sheet__h">{t("from")}</p>
          <ul className="an-gap__rows">
            {shown.map((r) => {
              const what = r.id === "base" ? t("base") : phrase(r.phrase);
              return (
                <li key={r.id} className="an-gap__row">
                  <span className="an-gap__what">{what}</span>
                  <span className="an-pts k-nums" data-sign={Math.sign(r.delta)}>
                    {signed(r.delta)}
                  </span>
                  <span className="an-gap__sides k-nums">{t("sides", { name: rival.member.label, other: side(r.other), mine: side(r.focus) })}</span>
                </li>
              );
            })}
          </ul>
          {rest.length ? <p className="an-gap__quiet">{t("rest", { n: rest.length, sum: signed(rest.reduce((s, r) => s + r.delta, 0)) })}</p> : null}
          {gap.rawGap !== gap.ratingGap ? <p className="an-gap__quiet">{t("clamped", { raw: signed(gap.rawGap), rating: signed(gap.ratingGap) })}</p> : null}
        </>
      )}
    </section>
  );
}
