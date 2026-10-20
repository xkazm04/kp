"use client";

import { useFormatter, useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { CohortDimension, CohortMember, CohortView, Phrase } from "../../cohortTypes";
import { CommentMark, DecoyMark, MemberName, MemberPress } from "../../dimensions/dimensionParts";
import { useAbsentWord } from "../../dimensions/useCohortLabel";
import { anatomyGeometry, besideReasons } from "./anatomyModel";
import { AnatomyBar, type Guide } from "./AnatomyBar";

/**
 * The field: one row per candidate on the floor, in its order (salary: by the asked figure,
 * never ranked), every bar on the same 0-100 scale so twenty compare at a glance, then the
 * pending ones drawn as the row itself, unfilled. A row is two presses: the name opens the full
 * report, the rest (rating, bar, why) focuses the candidate into the sheet.
 */
export function AnatomyField({ view, dimension, order, pending, focusId, guide, stops, phrase, onFocusMember, onOpenReport }: {
  view: CohortView;
  dimension: CohortDimension;
  order: CohortMember[];
  pending: CohortMember[];
  focusId: string | null;
  guide: Guide | null;
  stops: (id: string, slot: string) => boolean;
  phrase: (p: Phrase) => string;
  onFocusMember: (id: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerAnatomy.row");
  const format = useFormatter();
  const absentWord = useAbsentWord();
  const figure = (m: CohortMember): string => {
    const s = m.detail.salary;
    if (s?.midpoint == null) return ABSENT;
    return `${format.number(s.midpoint, { notation: "compact", maximumFractionDigits: 1 })} ${s.currency ?? ""}`.trim();
  };
  const row = (m: CohortMember, place: number | null) => {
    const cell = m.cells[dimension];
    const why = m.why[dimension];
    const geo = why?.anatomy ? anatomyGeometry(why.anatomy) : null;
    const isPending = cell.absentReason === "pending";
    const sentence = isPending ? absentWord("pending") : why ? phrase(why.why) : "";
    const label = isPending
      ? t("pending", { name: m.label })
      : t("press", { name: m.label, rating: cell.rating ?? ABSENT, why: sentence });
    return (
      <li key={m.memberId} className="an-row" data-an-row="" data-on={focusId === m.memberId ? "" : undefined} data-pending={isPending ? "" : undefined}>
        <span className="an-row__place k-nums">{place == null ? "" : dimension === "salary" ? figure(m) : t("place", { place })}</span>
        <span className="an-row__who">
          <MemberName member={m} onOpenReport={onOpenReport} />
          <DecoyMark member={m} view={view} />
          <CommentMark name={m.label} text={cell.comment} />
        </span>
        <MemberPress member={m} focusId={focusId} stop={stops(m.memberId, "row")} onFocusMember={onFocusMember} label={label} className="an-row__press">
          <span className="an-row__n k-nums" data-tier={cell.tier}>
            {cell.rating ?? ABSENT}
          </span>
          <AnatomyBar geo={geo} rating={cell.rating} guide={guide} phrase={phrase} pending={isPending} head={place === 1} />
          {why && !geo && !isPending ? (
            <span className="an-row__why an-row__beside">
              {besideReasons(why).map((r, i) => (
                <span key={i} className="an-row__said">
                  <span className="an-tone" data-tone={r.tone} aria-hidden />
                  <span className="an-row__said-t">{phrase(r.phrase)}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="an-row__why">{sentence}</span>
          )}
        </MemberPress>
      </li>
    );
  };
  return (
    <ol className="an-field" data-dimension={dimension} aria-label={t("label", { n: order.length })}>
      {order.map((m, i) => row(m, i + 1))}
      {pending.map((m) => row(m, null))}
    </ol>
  );
}
