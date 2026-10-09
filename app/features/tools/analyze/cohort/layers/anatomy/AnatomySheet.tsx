"use client";

import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { CohortDimension, CohortMember, CohortView, Phrase } from "../../cohortTypes";
import { CommentMark, DecoyMark, MemberName } from "../../dimensions/dimensionParts";
import { useAbsentWord } from "../../dimensions/useCohortLabel";
import { attachReasons, type Rival } from "./anatomyModel";
import { AnatomyGap } from "./AnatomyGap";
import { ReasonList } from "./AnatomyReasons";
import { AnatomySteps } from "./AnatomySteps";

/**
 * The focus sheet: the candidate the descent came from (or, before anyone is focused, the first
 * in order, said so) drawn LARGE — the why sentence, how they differ from the one they are
 * measured against (first: it is the shorter read and the 10-second question), every part of the
 * anatomy with its evidence (fit: the model's own pros and cons, labelled as judgement with no
 * point breakdown), and the reasons no part stands for.
 */
export function AnatomySheet({ view, dimension, member, focused, place, rated, rival, phrase, onOpenReport }: {
  view: CohortView;
  dimension: CohortDimension;
  member: CohortMember | null;
  focused: boolean;
  /** 1-based place in the field's order, or null when the member is not in it. */
  place: number | null;
  rated: number;
  rival: Rival;
  phrase: (p: Phrase) => string;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerAnatomy.sheet");
  const absentWord = useAbsentWord();
  if (!member) return <aside className="an-sheet an-sheet--empty">{t("empty")}</aside>;
  const cell = member.cells[dimension];
  const why = member.why[dimension];
  const attached = why ? attachReasons(why.anatomy, why) : null;
  const model = why != null && !why.anatomy;
  return (
    <aside className="an-sheet" aria-label={t("label", { name: member.label })} data-focused={focused ? "" : undefined}>
      <p className="an-sheet__kicker">
        {focused ? t("focused") : t("first")}
        {place != null ? <span className="an-sheet__place k-nums">{t(dimension === "salary" ? "byFigure" : "place", { place, rated })}</span> : null}
      </p>
      <div className="an-sheet__name">
        <MemberName member={member} onOpenReport={onOpenReport} />
        <DecoyMark member={member} view={view} />
        <CommentMark name={member.label} text={cell.comment} />
      </div>
      {cell.rating == null ? (
        <p className="an-sheet__absent">
          <span className="an-sheet__n k-nums">{ABSENT}</span> {absentWord(cell.absentReason ?? "notRead")}
        </p>
      ) : (
        <>
          <p className="an-sheet__figure">
            <span className="an-sheet__n k-nums">{cell.rating}</span>
            {why ? <span className="an-sheet__why">{phrase(why.why)}</span> : null}
          </p>
          {model ? (
            <p className="an-sheet__model">
              {t("modelTitle")}
            </p>
          ) : null}
          <AnatomyGap view={view} dimension={dimension} member={member} rival={rival} phrase={phrase} />
          {why?.anatomy && attached ? <AnatomySteps anatomy={why.anatomy} attached={attached} phrase={phrase} /> : null}
          {attached ? (
            <>
              <ReasonList title={model ? t("modelPros") : t("otherPros")} reasons={attached.pros} phrase={phrase} />
              <ReasonList title={model ? t("modelCons") : t("otherCons")} reasons={attached.cons} phrase={phrase} />
              <ReasonList title={t("notes")} reasons={attached.notes} phrase={phrase} />
            </>
          ) : null}
        </>
      )}
    </aside>
  );
}
