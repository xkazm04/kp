"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Phrase, ScoreAnatomy } from "../../cohortTypes";
import { anatomyGeometry, partStarts, phraseKey, signed, type Attached } from "./anatomyModel";
import { Evidence } from "./AnatomyReasons";

const span = (from: number, to: number) => ({ "--a": from, "--b": to }) as CSSProperties;

/**
 * The focused candidate's anatomy, large and in order, as a vertical waterfall: where the formula
 * starts, every part with its signed points and its own step on the 0-100 scale (a zero part is a
 * dot where it would have started), the reason's own wording and evidence, what the part fell
 * short of full by, and the rating it ends at (with the clamp named when the scale held it).
 */
export function AnatomySteps({ anatomy, attached, phrase }: { anatomy: ScoreAnatomy; attached: Attached; phrase: (p: Phrase) => string }) {
  const t = useTranslations("analyzeCohort.layerAnatomy.steps");
  const geo = anatomyGeometry(anatomy, 101);
  const byPart = new Map(geo.segs.map((s) => [s.part, s]));
  const starts = partStarts(anatomy);
  return (
    <ol className="an-steps" aria-label={t("label", { rating: anatomy.rating })}>
      {anatomy.base > 0 ? (
        <li className="an-step" data-kind="base">
          <span className="an-step__what">{t("start", { base: anatomy.base })}</span>
          <span className="an-pts k-nums">{anatomy.base}</span>
          <span className="an-step__track" aria-hidden>
            <span className="an-seg" data-kind="base" style={span(0, anatomy.base)} />
          </span>
        </li>
      ) : null}
      {attached.rows.map((row, i) => {
        const seg = byPart.get(i);
        const at = starts[i];
        const what = phrase(row.phrase);
        const own = row.reason && phraseKey(row.reason.phrase) !== phraseKey(row.phrase) ? phrase(row.reason.phrase) : null;
        return (
          <li key={i} className="an-step" data-kind={seg?.kind ?? "zero"} data-tone={row.tone}>
            <span className="an-step__what">
              {what}
              {own ? <span className="an-step__own">{own}</span> : null}
              {row.points === 0 || row.short ? (
                <span className="an-step__meta">
                  {row.points === 0 ? <span className="an-step__zero">{t(row.tone === "con" ? "zero" : "zeroPro")}</span> : null}
                  {row.short ? <span className="an-step__short">{t("short", { n: row.short })}</span> : null}
                </span>
              ) : null}
            </span>
            <span className="an-pts k-nums" data-sign={Math.sign(row.points)}>
              {signed(row.points)}
            </span>
            <span className="an-step__track" aria-hidden>
              {seg ? <span className="an-seg" data-kind={seg.kind} style={span(seg.from, seg.to)} /> : <span className="an-dot" style={span(at, at)} />}
            </span>
            <span className="an-step__ev">
              <Evidence reason={row.reason} what={what} />
            </span>
          </li>
        );
      })}
      <li className="an-step" data-kind="total">
        <span className="an-step__what">{geo.clamped ? t("clamped", { raw: anatomy.raw, rating: anatomy.rating }) : t("total")}</span>
        <span className="an-pts an-pts--total k-nums">{anatomy.rating}</span>
        <span className="an-step__track" aria-hidden>
          <span className="an-seg" data-kind="total" style={span(0, anatomy.rating)} />
        </span>
      </li>
    </ol>
  );
}

