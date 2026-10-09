"use client";

import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ScenePress } from "@/app/_components/kit/scene";
import { isTextPhrase, type CriterionStatus, type Phrase, type Reason } from "../../cohortTypes";

/**
 * A why-phrase in the reader's language: code-made words are keys under analyzeCohort.why, the
 * analysis's own prose renders verbatim. A key the catalog does not hold renders nothing rather
 * than the raw key (the engine's fixture test pins that every key resolves).
 */
export function usePhrase(): (p: Phrase) => string {
  const t = useTranslations("analyzeCohort.why");
  return useCallback(
    (p: Phrase) => {
      if (isTextPhrase(p)) return p.text;
      const key = p.key as Parameters<typeof t>[0];
      return t.has(key) ? t(key, p.params as Record<string, string | number> | undefined) : "";
    },
    [t]
  );
}

/** A signed rating-point figure with a typographic minus ("+17", "−17", "0"). */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/** The four criterion states as SHAPES first (disc, half, cross, open ring), colour second. */
export function StatusGlyph({ status }: { status: CriterionStatus | null }) {
  return (
    <svg className="hh-glyph" viewBox="0 0 16 16" aria-hidden data-status={status ?? "none"}>
      {status === "meets" ? (
        <circle cx="8" cy="8" r="5.5" />
      ) : status === "partial" ? (
        <>
          <circle className="hh-glyph__ring" cx="8" cy="8" r="5.5" />
          <path d="M8 2.5a5.5 5.5 0 0 0 0 11Z" />
        </>
      ) : status === "misses" ? (
        <path className="hh-glyph__x" d="m4 4 8 8M12 4l-8 8" />
      ) : status === "unknown" ? (
        <circle className="hh-glyph__ring hh-glyph__ring--dash" cx="8" cy="8" r="5.5" />
      ) : (
        <path className="hh-glyph__x" d="M4 8h8" />
      )}
    </svg>
  );
}

/** Points render only when the reason carries them (formula dimensions); fit never does. */
function Points({ points }: { points: number | undefined }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead");
  if (points === undefined) return null;
  return (
    <span className="hh-pts k-nums" data-sign={points > 0 ? "plus" : points < 0 ? "minus" : "zero"}>
      <span aria-hidden>{signed(points)}</span>
      <span className="sr-only">{t("pointsSr", { signed: signed(points) })}</span>
    </span>
  );
}

/**
 * One reason as a line: its tone mark, its words, its points when it has them, and, when the
 * analysis recorded supporting lines, an Evidence press that opens them (aria-expanded, never a
 * hover-only tip) and names the analysis field they came from.
 */
export function ReasonLine({ reason, quiet = false }: { reason: Reason; quiet?: boolean }) {
  const t = useTranslations("analyzeCohort.layerHeadToHead");
  const phrase = usePhrase();
  const [open, setOpen] = useState(false);
  const id = useId();
  const words = phrase(reason.phrase);
  if (!words) return null;
  return (
    <li className="hh-reason" data-tone={reason.tone} data-quiet={quiet ? "" : undefined}>
      <span className="hh-reason__mark" aria-hidden />
      <span className="hh-reason__body">
        <span className="hh-reason__words">{words}</span>
        <Points points={reason.points} />
        {reason.evidence?.length ? (
          <ScenePress className="hh-ev" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            {t("evidence.show")}
          </ScenePress>
        ) : null}
      </span>
      {open && reason.evidence?.length ? (
        <span id={id} className="hh-ev__lines" role="group" aria-label={t("evidence.label", { source: t(`evidence.source.${reason.source}`) })}>
          <span className="hh-ev__from">{t("evidence.label", { source: t(`evidence.source.${reason.source}`) })}</span>
          {reason.evidence.map((line) => (
            <span key={line} className="hh-ev__line">
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </li>
  );
}
