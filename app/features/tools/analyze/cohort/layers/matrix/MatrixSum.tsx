"use client";

import { useTranslations } from "next-intl";
import type { CohortDimension, CohortMember } from "../../cohortTypes";
import { MatrixGlyph } from "./MatrixGlyph";
import { anatomySum, pointLedger, signed, voiceOf, type Difference, type MatrixColumn } from "./matrixModel";
import { usePhrase } from "./usePhrase";
import { useMatrixWords } from "./useMatrixWords";

/**
 * How a formula rating adds up, as one line that checks (base, the signed terms, = the rating; the
 * clamp named when it moved the total), with any term no reason claims named underneath so every
 * figure has its words. Fit has no anatomy: it says "model judgement" instead of inventing points.
 */
export function SumLine({ member, d, orphans = true }: { member: CohortMember; d: CohortDimension; orphans?: boolean }) {
  const t = useTranslations("analyzeCohort.layerMatrix.readout");
  const phrase = usePhrase();
  const why = member.why[d];
  if (!why) return null;
  if (!why.anatomy) return d === "fit" ? <p className="mx-read__model">{t("model")}</p> : null;
  const sum = anatomySum(why.anatomy);
  const loose = orphans ? pointLedger(why).orphans : [];
  return (
    <>
      <p className="mx-read__sum k-nums">
        <span className="mx-read__sum-k">{t("built")}</span>
        <span>{t("base", { n: sum.base })}</span>
        {sum.parts.map((p, i) => (
          <span key={i} data-sign={p < 0 ? "neg" : "pos"}>
            {signed(p)}
          </span>
        ))}
        <span>= {sum.rating}</span>
        {sum.clamped ? <span className="mx-read__clamp">({t("clamped", { raw: sum.raw })})</span> : null}
      </p>
      {loose.length ? (
        <ul className="mx-read__orphans">
          {loose.map((p, i) => (
            <li key={i}>
              <span className="k-nums" data-sign={p.points < 0 ? "neg" : "pos"}>
                {signed(p.points)}
              </span>{" "}
              {phrase(p.phrase)}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** The reader's candidate against the reference column: both ratings, the reference's own why and sum, and every row where the statuses part. */
export function MatrixAgainst({ d, focus, refCol, diffs }: { d: CohortDimension; focus: MatrixColumn; refCol: MatrixColumn; diffs: readonly Difference[] }) {
  const t = useTranslations("analyzeCohort.layerMatrix.readout");
  const phrase = usePhrase();
  const w = useMatrixWords();
  const name = refCol.member.label;
  const refWhy = refCol.member.why[d];
  return (
    <section className="mx-read__vs">
      <h4 className="mx-reasons__h">{t("against", { name })}</h4>
      <p className="mx-read__vs-rating k-nums">{t("againstRating", { mine: focus.rating ?? "—", theirs: refCol.rating ?? "—", name })}</p>
      {refWhy ? <p className="mx-read__vs-why">{phrase(refWhy.why)}</p> : null}
      <SumLine member={refCol.member} d={d} orphans={false} />
      {diffs.length ? (
        <ul className="mx-read__diffs">
          {diffs.map((x) => {
            const voice = voiceOf(d, x.criterion.kind);
            return (
              <li key={x.criterion.id}>
                <span className="mx-read__diff-name">{phrase(x.criterion.phrase)}</span>
                <span className="mx-read__diff-pair">
                  <MatrixGlyph status={x.mine} /> {t("diffMine", { status: w.status(voice, x.mine) })}
                </span>
                <span className="mx-read__diff-pair">
                  <MatrixGlyph status={x.theirs} /> {t("diffTheirs", { status: w.status(voice, x.theirs), name })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mx-reasons__none">{t("same")}</p>
      )}
    </section>
  );
}
