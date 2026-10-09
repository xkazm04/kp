"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import type { Phrase } from "../../cohortTypes";
import { LABEL_MIN_PCT, signed, type Geometry, type Seg } from "./anatomyModel";
import { useTerse } from "./usePhrase";

/** Where the first in order sits on the shared scale, and whether the claim lets it lead. */
export interface Guide {
  at: number;
  kind: "leader" | "first";
}

const span = (from: number, to: number) => ({ "--a": from, "--b": to }) as CSSProperties;

/**
 * One candidate's rating as it was BUILT, on the shared 0-100 scale: the base, every earning
 * part as its own block (blocks are counted, so six skills read as six), half credit hatched
 * light, the lost run hatched back from the peak, the unearned rest left empty and named where a
 * part earned nothing, a cap at the rating, and the first-in-order guide. `geo` null with a
 * rating = model judgement (fit): the rating drawn plainly, no parts to show.
 */
export function AnatomyBar({ geo, rating, guide, phrase, pending, head }: {
  geo: Geometry | null;
  rating: number | null;
  guide: Guide | null;
  phrase: (p: Phrase) => string;
  pending?: boolean;
  /** The field's first row: it names the base (or the model's plain bar) in words, as a column head, not twenty repeats. */
  head?: boolean;
}) {
  const t = useTranslations("analyzeCohort.layerAnatomy.bar");
  const terse = useTerse(phrase);
  const word = (s: Seg): string => {
    if (s.kind === "base") return t("base", { base: s.points });
    const name = s.phrase ? terse(s.phrase) : "";
    // a lost run names its points first; the phrase follows only where there is room for both
    return s.kind === "lose" ? (s.to - s.from >= LABEL_MIN_PCT * 2 ? `${signed(s.points)} ${name}` : signed(s.points)) : name;
  };
  const tip = (s: Seg): string => (s.kind === "base" ? t("base", { base: s.points }) : t("part", { what: s.phrase ? phrase(s.phrase) : "", points: signed(s.points) }));
  const end = geo ? Math.max(0, Math.min(100, Math.max(geo.peak, geo.rating))) : (rating ?? 0);
  // the base is named only where the lost run does not cover the words
  const baseRoom = geo ? Math.min(100, ...geo.segs.filter((s) => s.kind === "lose").map((s) => s.from)) : 0;
  const unearned = geo?.zeroCons.length ? geo.zeroCons.map(terse).join(", ") : null;
  return (
    <span className="an-bar" data-pending={pending ? "" : undefined} data-model={!geo && rating != null ? "" : undefined} aria-hidden>
      {geo
        ? geo.segs.map((s, i) => (
            <span key={`${s.part}-${i}`} className="an-seg" data-kind={s.kind} style={span(s.from, s.to)} data-dim-tip={tip(s)}>
              {s.label && (s.kind !== "base" || (head && Math.min(s.to, baseRoom) - s.from >= LABEL_MIN_PCT * 2.5)) ? <span className="an-seg__t">{word(s)}</span> : null}
            </span>
          ))
        : null}
      {!geo && rating != null ? (
        <span className="an-seg" data-kind="model" style={span(0, rating)}>
          {head && rating >= LABEL_MIN_PCT * 2 ? <span className="an-seg__t">{t("model")}</span> : null}
        </span>
      ) : null}
      {unearned && end < 100 ? (
        <span className="an-rest" style={span(end, 100)} data-dim-tip={t("notEarned", { names: unearned })}>
          {100 - end >= LABEL_MIN_PCT ? <span className="an-seg__t">{t("notEarned", { names: unearned })}</span> : null}
        </span>
      ) : null}
      {rating != null ? <span className="an-cap" style={span(rating, rating)} /> : null}
      {guide ? <span className="an-guide" data-kind={guide.kind} style={span(guide.at, guide.at)} /> : null}
    </span>
  );
}
