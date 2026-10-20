"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import type { CohortDimension, CohortView } from "../../cohortTypes";
import { CommentMark, DecoyMark, MemberName } from "../../dimensions/dimensionParts";
import { pointRoles, type Difference, type MatrixColumn } from "./matrixModel";
import { MatrixReasons } from "./MatrixReasons";
import { MatrixAgainst, SumLine } from "./MatrixSum";
import { usePhrase } from "./usePhrase";

/**
 * Under the matrix: the reader's column explained. Who, the rating and its one-line why, how the
 * number was BUILT (the anatomy as a sum that checks, or "model judgement" for fit), the pros,
 * the cons and the notes with their evidence, and the rows where this candidate differs from the
 * column they are read against.
 */
export function MatrixReadout({ view, d, focus, refCol, diffs, chosen, pendingName, onOpenReport }: {
  view: CohortView;
  d: CohortDimension;
  focus: MatrixColumn;
  refCol: MatrixColumn | null;
  diffs: readonly Difference[];
  /** The reader picked this column (else it is the first column, by default). */
  chosen: boolean;
  /** The member the reader pressed while they are still analyzing (the readout falls back to the first column). */
  pendingName: string | null;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerMatrix");
  const phrase = usePhrase();
  const idBase = useId();
  const m = focus.member;
  const why = m.why[d];
  if (!why) return null;
  const cell = m.cells[d];
  const roles = pointRoles(why);
  const kicker = pendingName ? t("readout.kickerPending", { name: pendingName }) : chosen ? t("readout.kicker") : t("readout.kickerFirst");
  return (
    <section className="mx-read" aria-label={t("readout.label", { name: m.label, rating: cell.rating ?? "—" })} data-tier={cell.tier}>
      <div className="mx-read__who">
        <p className="mx-read__kicker">{kicker}</p>
        <div className="mx-read__name">
          <MemberName member={m} onOpenReport={onOpenReport} />
          <DecoyMark member={m} view={view} />
          <CommentMark name={m.label} text={cell.comment} />
        </div>
        <p className="mx-read__figure">
          <span className="mx-read__rating k-nums">{cell.rating ?? "—"}</span>
          <span className="mx-read__tier">{t(`tier.${cell.tier}`)}</span>
        </p>
        <p className="mx-read__why">{phrase(why.why)}</p>
        <SumLine member={m} d={d} />
      </div>
      <MatrixReasons title={t("readout.pros")} tone="pro" reasons={why.pros} roles={roles} idBase={idBase} />
      <div className="mx-read__stack">
        <MatrixReasons title={t("readout.cons")} tone="con" reasons={why.cons} roles={roles} idBase={idBase} />
        {why.notes.length ? <MatrixReasons title={t("readout.notes")} tone="note" reasons={why.notes} roles={roles} idBase={idBase} /> : null}
      </div>
      {refCol ? <MatrixAgainst d={d} focus={focus} refCol={refCol} diffs={diffs} /> : null}
    </section>
  );
}
