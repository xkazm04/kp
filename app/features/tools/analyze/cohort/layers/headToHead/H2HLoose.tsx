"use client";

import { useTranslations } from "next-intl";
import type { CohortDimension, CohortMember, CohortView, Reason } from "../../cohortTypes";
import { alignLoose, type OwnReasons } from "./headToHeadModel";
import { ReasonLine, signed, usePhrase } from "./h2hParts";

function OwnCell({ own }: { own: OwnReasons }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.loose");
  const lists: Array<["pros" | "cons" | "notes", Reason[]]> = [
    ["pros", own.pros],
    ["cons", own.cons],
    ["notes", own.notes],
  ];
  const any = lists.some(([, l]) => l.length);
  return (
    <div className="hh-cell hh-cell--own" role="cell">
      {any ? (
        lists.map(([k, l]) =>
          l.length ? (
            <div key={k} className="hh-own" data-tone={k}>
              <span className="hh-own__k">{t(k)}</span>
              <ul className="hh-reasons">
                {l.map((r, i) => (
                  <ReasonLine key={i} reason={r} quiet={k === "notes"} />
                ))}
              </ul>
            </div>
          ) : null
        )
      ) : (
        <p className="hh-quiet">{t("ownNone")}</p>
      )}
    </div>
  );
}

/**
 * The pros and cons that map onto no criterion (a strength in the analysis's words, a GitHub
 * activity part, a probe to ask). A reason two or more candidates hold is ONE aligned row, so a
 * shared strength reads as shared; everything else is each candidate's own, listed in their column.
 * Omitted when no candidate has any.
 */
export function H2HLoose({ view, dimension, cols }: { view: CohortView; dimension: CohortDimension; cols: readonly CohortMember[] }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead.loose");
  const phrase = usePhrase();
  const { shared, own } = alignLoose(view, dimension, cols);
  const allHeld = shared.filter((s) => s.all);
  const anyOwn = own.some((o) => o.pros.length + o.cons.length + o.notes.length > 0);
  if (!shared.length && !anyOwn) return null;
  return (
    <>
      <div className="hh-row hh-row--section" role="row">
        <div className="hh-span" role="cell">
          <h4 className="hh-section">{t("title")}</h4>
        </div>
      </div>
      {shared.filter((s) => !s.all).map((s) => (
        <div key={s.key} className="hh-row" role="row" data-shared="">
          <div className="hh-label" role="rowheader">
            <span className="hh-label__kind" data-tone={s.tone}>
              {t(s.tone === "pro" ? "pro" : s.tone === "con" ? "con" : "note")}
            </span>
            <span className="hh-label__words">{phrase(s.phrase)}</span>
            <span className="hh-label__shared">{t("shared")}</span>
          </div>
          {s.cells.map((r, i) => (
            <div key={cols[i].memberId} className="hh-cell hh-cell--held" role="cell" data-held={r ? "" : undefined} data-tone={s.tone}>
              {r ? (
                <span className="hh-held">
                  <span className="hh-held__mark" aria-hidden />
                  {r.points !== undefined ? <span className="hh-pts k-nums">{signed(r.points)}</span> : t("holds")}
                </span>
              ) : (
                <span className="hh-held hh-held--not">{t("notTheirs", { name: cols[i].label })}</span>
              )}
            </div>
          ))}
        </div>
      ))}
      {allHeld.length ? (
        <div className="hh-row hh-row--agree" role="row">
          <div className="hh-span hh-agree" role="cell">
            <ul className="hh-agree__groups">
              {(["pro", "con", "note"] as const).map((tone) => {
                const rows = allHeld.filter((s) => s.tone === tone);
                return rows.length ? (
                  <li key={tone} className="hh-agree__group" data-tone={tone}>
                    <span className="hh-agree__status">{t(`allHold.${tone}`)}</span>
                    <span className="hh-agree__words">{rows.map((s) => phrase(s.phrase)).join(" · ")}</span>
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        </div>
      ) : null}
      {anyOwn ? (
        <div className="hh-row" role="row">
          <div className="hh-label" role="rowheader">
            <span className="hh-label__words">{t("own")}</span>
          </div>
          {own.map((o) => (
            <OwnCell key={o.memberId} own={o} />
          ))}
        </div>
      ) : null}
    </>
  );
}
