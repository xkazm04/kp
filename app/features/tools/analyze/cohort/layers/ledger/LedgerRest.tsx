"use client";

import { useTranslations } from "next-intl";
import { ABSENT } from "@/app/_components/kit";
import type { AbsentReason, CohortDimension, CohortMember, CohortView } from "../../cohortTypes";
import { DecoyMark, MemberName, MemberPress } from "../../dimensions/dimensionParts";
import { useAbsentWord, useCohortLabel } from "../../dimensions/useCohortLabel";

/**
 * The ledger's tail, after every rated row: who is still analyzing (drawn as the row itself, unfilled,
 * so nothing reflows when the analysis lands) and who has no rating here, grouped by WHY. Never a 0:
 * the rating column holds the absence mark and the reason, the group's heading says what that means, and
 * a figure an absent cell still carries (a salary in another currency) is shown, never compared.
 */
export function LedgerRest({ view, dimension, reason, members, focusId, stops, onFocusMember, onOpenReport }: {
  view: CohortView;
  dimension: CohortDimension;
  reason: AbsentReason;
  members: readonly CohortMember[];
  focusId: string | null;
  stops: (id: string, slot: string) => boolean;
  onFocusMember: (id: string | null) => void;
  onOpenReport: (slug: string) => void;
}) {
  const t = useTranslations("analyzeCohort.layerLedger");
  const word = useAbsentWord()(reason);
  const label = useCohortLabel();
  return (
    <section className="lg-group" data-reason={reason} aria-label={t("restGroup", { reason: word, n: members.length })}>
      <h3 className="lg-group__h">
        <span className="lg-dash" aria-hidden>
          {ABSENT}
        </span>
        {word}
        <span className="lg-group__n k-nums">{members.length}</span>
        <span className="lg-group__why">{t(`restWhy.${reason}`)}</span>
      </h3>
      <ul className="lg-rows">
        {members.map((m) => {
          const cell = m.cells[dimension];
          const figure = cell.label.key === "none" ? "" : label(cell.label);
          return (
            <li key={m.memberId} className="lg-row lg-row--rest" data-lg-row={m.memberId} data-on={focusId === m.memberId ? "" : undefined}>
              <MemberPress
                member={m}
                focusId={focusId}
                stop={stops(m.memberId, `rest-${reason}`)}
                onFocusMember={onFocusMember}
                className="lg-pos lg-pos--rest"
                label={t("pressRest", { name: m.label, reason: word })}
              >
                <span className="lg-pos__n" aria-hidden>
                  {ABSENT}
                </span>
              </MemberPress>
              <div className="lg-who">
                <MemberName member={m} onOpenReport={onOpenReport} />
                <DecoyMark member={m} view={view} />
              </div>
              <p className="lg-rate lg-rate--rest">
                <span className="lg-dash" aria-hidden>
                  {ABSENT}
                </span>
                {word}
              </p>
              {figure ? (
                <p className="lg-why lg-why--rest">
                  <span className="lg-why__figure k-nums">{figure}</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
