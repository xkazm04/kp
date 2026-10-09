"use client";

import { useTranslations } from "next-intl";
import type { CohortView } from "../cohortTypes";
import type { FitRow } from "./fitModel";
import { useAbsentWord, useCohortLabel } from "./useCohortLabel";

/**
 * The fit page's side sheet for the focused member: why their band is as wide as it is (the
 * named drivers: a wide band is a property of the RECORD, not of the person), then what the
 * analysis said about the fit, verbatim in the report language.
 */
export function FitFocus({ view, rows, focusMemberId }: { view: CohortView; rows: FitRow[]; focusMemberId: string | null }) {
  const t = useTranslations("analyzeCohort.pages.fit");
  const label = useCohortLabel();
  const reasonWord = useAbsentWord();
  const member = focusMemberId ? view.members.find((m) => m.memberId === focusMemberId) : undefined;
  if (!member) {
    return (
      <aside className="cd-focus" aria-live="polite">
        <p className="cd-focus__prompt">{t("focusPrompt")}</p>
      </aside>
    );
  }
  const row = rows.find((r) => r.member.memberId === member.memberId);
  const d = member.detail.fit;
  const cell = member.cells.fit;
  return (
    <aside className="cd-focus" aria-live="polite" aria-label={member.label}>
      <p className="cd-focus__kicker">{t("focusKicker")}</p>
      <h3 className="cd-focus__name">{member.label}</h3>
      {row ? (
        <>
          <p className="cd-focus__figure k-nums">
            {t("bandFigure", { rating: row.rating, lo: row.lo, hi: row.hi, width: row.hi - row.lo })}
          </p>
          <h4 className="cd-focus__h">{t("drivers")}</h4>
          {row.drivers.length ? (
            <ul className="cd-focus__list">
              {row.drivers.map((dr) => (
                <li key={dr.key}>{label(dr)}</li>
              ))}
            </ul>
          ) : (
            <p className="cd-focus__quiet">{t("driversNone")}</p>
          )}
        </>
      ) : (
        <p className="cd-focus__quiet">{reasonWord(cell.absentReason ?? "notRead")}</p>
      )}
      {d?.summary ? <p className="cd-focus__prose">{d.summary}</p> : null}
      {d?.seniorityAlignment || d?.roleAlignment ? (
        <dl className="cd-focus__dl">
          {d.seniorityAlignment ? (
            <>
              <dt>{t("seniority")}</dt>
              <dd>{d.seniorityAlignment}</dd>
            </>
          ) : null}
          {d.roleAlignment ? (
            <>
              <dt>{t("role")}</dt>
              <dd>{d.roleAlignment}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {d?.riskFlags.length ? (
        <>
          <h4 className="cd-focus__h">{t("risks")}</h4>
          <ul className="cd-focus__list cd-focus__list--risk">
            {d.riskFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
