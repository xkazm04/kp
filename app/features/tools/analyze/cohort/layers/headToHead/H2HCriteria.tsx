"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import { ABSENT } from "@/app/_components/kit";
import type { CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { alignCriteria, type CriterionCell, type CriterionRow } from "./headToHeadModel";
import { ReasonLine, StatusGlyph, usePhrase } from "./h2hParts";

const FOLD = "hh-fold";

function Cell({ cell }: { cell: CriterionCell }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead");
  const phrase = usePhrase();
  const status = cell.status ? t(`status.${cell.status}`) : t("criteria.noReading");
  const note = cell.note ? phrase(cell.note) : "";
  // the criterion's own note often repeats a reason's words: say it once
  const noteIsNew = note && !cell.reasons.some((r) => phrase(r.phrase) === note);
  return (
    <div className="hh-cell" role="cell" data-status={cell.status ?? "none"}>
      <span className="hh-cell__status">
        <StatusGlyph status={cell.status} />
        <span>{cell.status ? status : ABSENT}</span>
      </span>
      {cell.reasons.length ? (
        <ul className="hh-reasons">
          {cell.reasons.map((r, i) => (
            <ReasonLine key={i} reason={r} quiet={r.tone === "note"} />
          ))}
        </ul>
      ) : null}
      {noteIsNew ? <p className="hh-cell__note">{note}</p> : null}
    </div>
  );
}

/** One criterion across the columns: the role's words on the left, each candidate's status and reasons beside. */
function Row({ row }: { row: CriterionRow }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead");
  const phrase = usePhrase();
  return (
    <div className="hh-row" role="row" data-differs={row.differs ? "" : undefined}>
      <div className="hh-label" role="rowheader">
        <span className="hh-label__kind" data-kind={row.criterion.kind}>
          {t(`kind.${row.criterion.kind}`)}
        </span>
        <span className="hh-label__words">{phrase(row.criterion.phrase)}</span>
        {row.differs ? <span className="hh-label__differs">{t("criteria.differs")}</span> : null}
      </div>
      {row.cells.map((c) => (
        <Cell key={c.memberId} cell={c} />
      ))}
    </div>
  );
}

/**
 * The role's criteria for this dimension, aligned across the head-to-head. Rows where the
 * candidates DIFFER stand open at the top, emphasised; rows where they agree fold into one line
 * per shared status ("All meet: Java, Spring Boot…") that can be unfolded into full rows.
 */
export function H2HCriteria({ view, dimension, cols }: { view: CohortView; dimension: CohortDimension; cols: readonly CohortMember[] }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead");
  const td = useTranslations("analyzeCohort.dims");
  const phrase = usePhrase();
  const [unfold, setUnfold] = useState(false);
  const foldId = useId();
  const { open, agree } = alignCriteria(view, dimension, cols);
  const folded = agree.flatMap((g) => g.rows);
  if (!open.length && !folded.length) {
    return <p className="hh-empty">{t("criteria.none", { dimension: td(dimension) })}</p>;
  }
  return (
    <>
      <div className="hh-row hh-row--section" role="row">
        <div className="hh-span" role="cell">
          <h4 className="hh-section">{t("criteria.title")}</h4>
        </div>
      </div>
      {open.map((row) => (
        <Row key={row.criterion.id} row={row} />
      ))}
      {!open.length && folded.length ? (
        <div className="hh-row" role="row">
          <p className="hh-span hh-quiet" role="cell">
            {t("criteria.noneDiffer")}
          </p>
        </div>
      ) : null}
      {agree.length ? (
        <div className="hh-row hh-row--agree" role="row">
          <div className="hh-span hh-agree" role="cell">
            <span className="hh-agree__title">{t("criteria.agreeTitle")}</span>
            <ul className="hh-agree__groups">
              {agree.map((g) => (
                <li key={g.status} className="hh-agree__group" data-status={g.status}>
                  <span className="hh-agree__status">
                    <StatusGlyph status={g.status} />
                    {t(`criteria.agree.${g.status}`)}
                  </span>
                  <span className="hh-agree__words">{g.rows.map((r) => phrase(r.criterion.phrase)).join(" · ")}</span>
                </li>
              ))}
            </ul>
            <ScenePress className={FOLD} aria-expanded={unfold} aria-controls={foldId} onClick={() => setUnfold((u) => !u)}>
              {unfold ? t("criteria.hide") : t("criteria.show", { n: folded.length })}
            </ScenePress>
          </div>
        </div>
      ) : null}
      <div id={foldId} className="hh-unfold" role="rowgroup" hidden={!unfold}>
        {unfold ? folded.map((row) => <Row key={row.criterion.id} row={row} />) : null}
      </div>
    </>
  );
}
