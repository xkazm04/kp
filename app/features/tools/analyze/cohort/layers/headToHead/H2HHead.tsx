"use client";

import { useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import { ABSENT, KitIcon } from "@/app/_components/kit";
import { CRITERION_STATUSES, type CohortDimension, type CohortMember, type CohortView } from "../../cohortTypes";
import { CommentMark, DecoyMark, MemberName } from "../../dimensions/dimensionParts";
import { useAbsentWord } from "../../dimensions/useCohortLabel";
import { builtOf, deltaOf, type FieldRow } from "./headToHeadModel";
import { StatusGlyph, signed, usePhrase } from "./h2hParts";

const REMOVE = "hh-remove";

/** How the rating was built, in one line: base, earned, lost, result; fit says it has no breakdown. */
function BuiltLine({ member, dimension }: { member: CohortMember; dimension: CohortDimension }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.head");
  const b = builtOf(member, dimension);
  if (member.cells[dimension].rating == null) return null;
  if (b.kind === "model") return <p className="hh-built" data-kind="model">{t("model")}</p>;
  if (b.kind === "none") return <p className="hh-built" data-kind="none">{t("noBuild")}</p>;
  return <p className="hh-built k-nums">{t(b.clamped ? "builtClamped" : "built", { base: b.base, earned: b.earned, lost: b.lost, raw: b.raw, rating: b.rating })}</p>;
}

/** The line under the rating: the gap to the first column (salary: the figure itself, never a gap). */
function StandLine({ view, member, first, dimension }: { view: CohortView; member: CohortMember; first: CohortMember; dimension: CohortDimension }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.head");
  if (dimension === "salary") {
    const s = member.detail.salary;
    return (
      <p className="hh-stand">
        {s?.midpoint != null && s.currency
          ? t("salary", { amount: s.midpoint, currency: s.currency, period: s.period ?? "other" })
          : t("salaryNone")}
      </p>
    );
  }
  if (member === first) return view.members.length > 1 ? <p className="hh-stand hh-stand--ref">{t("against")}</p> : null;
  const d = deltaOf(first, member, dimension);
  if (!d) return null;
  return (
    <p className="hh-stand" data-gap={d.gap ?? undefined}>
      <span className="hh-stand__n k-nums">{d.delta === 0 ? t("deltaSame", { name: first.label }) : t("delta", { signed: signed(d.delta), name: first.label })}</span>
      {d.gap ? <span className="hh-stand__gap">{t(d.gap === "clears" ? "gapClears" : "gapOverlaps")}</span> : null}
    </p>
  );
}

/**
 * The corners of the head-to-head, one card per candidate: who (the name opens the report), where
 * they stand on this dimension (rank as an order, never a crown; salary is a figure, never a rank),
 * the rating with its band, the gap to the first column, the ONE sentence that says why the rating
 * sits there, and how the rating was built. A card can be taken out of the head-to-head.
 */
export function H2HHead({ view, dimension, cols, focusId, ranks, onRemove, onOpenReport }: {
  view: CohortView;
  dimension: CohortDimension;
  cols: readonly CohortMember[];
  focusId: string | null;
  ranks: ReadonlyMap<string, FieldRow>;
  onRemove: (m: CohortMember) => void;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.head");
  const td = useTranslations("analyzeCohort.dims");
  const tl = useTranslations("analyzeCohort.layerHeadToHead");
  const phrase = usePhrase();
  const reason = useAbsentWord();
  const rated = view.claims.byDimension[dimension].rated;
  return (
    <div className="hh-row hh-row--head" role="row">
      <div className="hh-corner" role="columnheader">
        <span className="hh-corner__dim">{td(dimension)}</span>
        <ul className="hh-legend" aria-label={tl("legend")}>
          {CRITERION_STATUSES.map((s) => (
            <li key={s} data-status={s}>
              <StatusGlyph status={s} />
              {tl(`status.${s}`)}
            </li>
          ))}
        </ul>
      </div>
      {cols.map((m, i) => {
        const cell = m.cells[dimension];
        const why = m.why[dimension];
        const rank = ranks.get(m.memberId);
        const focus = m.memberId === focusId;
        const remove = focus ? t("unfocus", { name: m.label }) : t("remove", { name: m.label });
        return (
          <div key={m.memberId} className="hh-card" role="columnheader" data-focus={focus ? "" : undefined} data-tier={cell.tier} data-at={i}>
            <div className="hh-card__top">
              {focus ? <span className="hh-card__flag">{t("inFocus")}</span> : null}
              {dimension === "salary" ? (
                <span className="hh-card__rank">{t("salaryNever")}</span>
              ) : rank ? (
                <span className="hh-card__rank k-nums">{t(rank.tied ? "rankTied" : "rank", { rank: rank.rank, rated, dimension: td(dimension) })}</span>
              ) : null}
              <ScenePress className={REMOVE} aria-label={remove} data-dim-tip={remove} onClick={() => onRemove(m)}>
                <KitIcon name="x" />
              </ScenePress>
            </div>
            <div className="hh-card__name">
              <MemberName member={m} onOpenReport={onOpenReport} />
              <DecoyMark member={m} view={view} />
              <CommentMark name={m.label} text={cell.comment} />
            </div>
            {cell.rating == null ? (
              <p className="hh-card__rating" data-absent="">
                <span className="hh-card__num" aria-hidden>
                  {ABSENT}
                </span>
                <span className="hh-card__tier">{t("absent", { dimension: td(dimension), reason: cell.absentReason ? reason(cell.absentReason) : "" })}</span>
              </p>
            ) : (
              <p className="hh-card__rating" aria-label={t("ratingName", { name: m.label, rating: cell.rating, dimension: td(dimension) })}>
                <span className="hh-card__num k-nums" aria-hidden>
                  {cell.rating}
                </span>
                <span className="hh-card__tier" aria-hidden>
                  {dimension === "salary" ? t("salaryRating") : t(`tier.${cell.tier as "strong" | "solid" | "thin" | "weak"}`)}
                  {cell.band ? <span className="hh-card__band k-nums">{t("band", { lo: cell.band.lo, hi: cell.band.hi })}</span> : null}
                </span>
              </p>
            )}
            <StandLine view={view} member={m} first={cols[0]} dimension={dimension} />
            {why ? <p className="hh-card__why">{phrase(why.why)}</p> : null}
            <BuiltLine member={m} dimension={dimension} />
          </div>
        );
      })}
    </div>
  );
}
