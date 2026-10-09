"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Phrase, Reason } from "../../cohortTypes";
import { signed } from "./anatomyModel";

/**
 * A reason's evidence: a press (aria-expanded, never `title=`) that opens the analysis's own
 * supporting lines verbatim, under a line naming which analysis field they came from.
 */
export function Evidence({ reason, what }: { reason: Reason | null; what: string }) {
  const t = useTranslations("analyzeCohort.layerAnatomy.evidence");
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!reason?.evidence?.length) return null;
  return (
    <>
      <Button
        className="an-ev__btn"
        variant="link"
        size="sm"
        icon={open ? "up" : "down"}
        label={t("show", { n: reason.evidence.length })}
        aria-label={t("showFor", { what, n: reason.evidence.length })}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      />
      {open ? (
        <div id={id} className="an-ev">
          <p className="an-ev__from">{t("from", { source: reason.source })}</p>
          <ul className="an-ev__list">
            {reason.evidence.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * Reasons as a list: the tone's shape (a plus, a minus, a dot), the phrase, signed points ONLY
 * where the reason carries them (never on fit), and the evidence expand.
 */
export function ReasonList({ title, reasons, phrase }: { title: string; reasons: Reason[]; phrase: (p: Phrase) => string }) {
  if (!reasons.length) return null;
  return (
    <section className="an-reasons">
      <h4 className="an-sheet__h">{title}</h4>
      <ul className="an-reasons__list">
        {reasons.map((r, i) => {
          const what = phrase(r.phrase);
          return (
            <li key={i} className="an-reason" data-tone={r.tone}>
              <span className="an-tone" data-tone={r.tone} aria-hidden />
              <span className="an-reason__what">{what}</span>
              {r.points !== undefined ? <span className="an-pts k-nums" data-sign={Math.sign(r.points)}>{signed(r.points)}</span> : null}
              <Evidence reason={r} what={what} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
