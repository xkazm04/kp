"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import { CommentMark, MemberName, MemberPress } from "./dimensionParts";
import { pctOn } from "./dimensionModel";
import type { SalaryRuler as Ruler } from "./salaryModel";

/**
 * One currency/pay-basis partition on its own ruler. Each row is a member's expected range
 * (min to max) with the midpoint marked; the comparable ruler may shade the window it was rated
 * against. A refused partition is headed "not comparable" and its figures are never converted.
 * Rows run low to high by midpoint: an order of cost, never a rank, so no row is crowned.
 */
export function SalaryRuler({ ruler, focusId, onFocusMember, onOpenReport, stops }: {
  ruler: Ruler;
  focusId: string | null;
  onFocusMember: (id: string | null) => void;
  onOpenReport: (slug: string) => void;
  stops: (id: string, slot: string) => boolean;
}) {
  const t = useTranslations("analyzeCohort.pages.salary");
  const locale = useLocale();
  const n = useNumberFormat();
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }), [locale]);
  const { min, max, ticks } = ruler.scale;
  const at = (v: number) => pctOn(v, min, max);
  const period = t("period", { period: ruler.period });
  const win = ruler.window;
  const basis = ruler.basis === "role" ? t("basisRole") : ruler.basis === "cohort" ? t("basisCohort") : t("notComparableWhy");

  return (
    <section className="cd-ruler" data-comparable={ruler.comparable ? "" : undefined} aria-label={ruler.key}>
      <header className="cd-ruler__head">
        <h3 className="cd-ruler__title">
          {ruler.comparable ? t("comparable", { currency: ruler.currency, period }) : t("notComparable", { currency: ruler.currency, period })}
        </h3>
        <p className="cd-ruler__basis">{basis}</p>
      </header>
      <div className="cd-ruler__axis" aria-hidden>
        {ticks.map((v) => (
          <span key={v} style={{ left: `${at(v)}%` }}>
            {compact.format(v)}
          </span>
        ))}
      </div>
      <ol className="cd-ruler__rows">
        {ruler.rows.map((r) => {
          const id = r.member.memberId;
          const range = t("range", { name: r.member.label, min: n.grouped(r.min), max: n.grouped(r.max), mid: n.grouped(r.mid), currency: ruler.currency, period });
          const band = r.inBand == null ? null : r.inBand ? t("inBand") : t("outBand");
          return (
            <li key={id} className="cd-ruler__row" data-on={focusId === id ? "" : undefined}>
              <span className="cd-ruler__who">
                <MemberName member={r.member} onOpenReport={onOpenReport} />
                <CommentMark name={r.member.label} text={r.member.cells.salary.comment} />
              </span>
              <MemberPress
                member={r.member}
                focusId={focusId}
                stop={stops(id, `ruler:${ruler.key}`)}
                onFocusMember={onFocusMember}
                label={band ? `${range}, ${band}` : range}
                tip={t("confidence", { c: r.confidence ?? "other" })}
                className="cd-ruler__track"
              >
                {win ? <i className="cd-ruler__win" style={{ left: `${at(win.lo)}%`, width: `${at(win.hi) - at(win.lo)}%` }} /> : null}
                {ticks.map((v) => (
                  <i key={v} className="cd-fit__tick" style={{ left: `${at(v)}%` }} />
                ))}
                <i className="cd-ruler__range" data-conf={r.confidence ?? "unknown"} style={{ left: `${at(r.min)}%`, width: `${Math.max(0.6, at(r.max) - at(r.min))}%` }} />
                <i className="cd-ruler__mid" style={{ left: `${at(r.mid)}%` }} />
              </MemberPress>
              <span className="cd-ruler__fig">
                <span className="k-nums">{n.grouped(r.mid)}</span>
                {band ? (
                  <span className="cd-ruler__band" data-in={r.inBand ? "" : undefined}>
                    {band}
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {win ? <p className="cd-ruler__median">{t("median", { mid: n.grouped(Math.round(win.median)), currency: ruler.currency })}</p> : null}
    </section>
  );
}
