"use client";

import { useLocale } from "next-intl";
import { formatCount } from "./figure";
import { scoreBarClass, scorePct } from "./doc";
import "./kit.css";
import "./doc.css";

export type Score = {
  key: string;
  label: string;
  /** 0..100. */
  value: number;
  /** The meter's accessible name, e.g. "Judgment: 72 out of 100" (the caller's catalog owns it). */
  meterLabel: string;
};

/**
 * @catalog Scores out of 100 as labelled meters (a credential's capability axes): name and numeral on one line, a full-width bar under it; a 0 keeps a baseline tick so it reads "low", never "missing".
 */
export function ScoreList({ items }: { items: Score[] }) {
  const locale = useLocale();
  return (
    <ul className="k-scores" data-part="score-list">
      {items.map((s) => {
        const pct = scorePct(s.value);
        return (
          <li key={s.key}>
            <div className="k-scores__line">
              <span>{s.label}</span>
              <span className="k-nums">{formatCount(Math.round(s.value), locale)}</span>
            </div>
            <div
              role="meter"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={s.meterLabel}
              className={scoreBarClass(s.value)}
            >
              {pct > 0 ? <i style={{ width: `${pct}%` }} /> : <i aria-hidden />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
