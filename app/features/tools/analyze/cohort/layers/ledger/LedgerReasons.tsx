"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Reason, ReasonTone } from "../../cohortTypes";
import { signed } from "./ledgerModel";
import { usePhrase } from "./usePhrase";

/** The tone as a SHAPE before a colour: a plus disc earns, a minus disc costs, an open diamond is context. */
export function ToneGlyph({ tone }: { tone: ReasonTone }) {
  return (
    <svg className="lg-glyph" data-tone={tone} viewBox="0 0 14 14" aria-hidden>
      {tone === "note" ? (
        <path className="lg-glyph__ring" d="M7 2.2 11.8 7 7 11.8 2.2 7Z" />
      ) : (
        <>
          <circle className="lg-glyph__ring" cx="7" cy="7" r="5.6" />
          <path className="lg-glyph__mark" d={tone === "pro" ? "M4.4 7h5.2M7 4.4v5.2" : "M4.4 7h5.2"} />
        </>
      )}
    </svg>
  );
}

/** Rating points, signed — drawn ONLY when the reason carries them (never on fit, which is model-given). */
function Points({ points }: { points: number | undefined }) {
  if (points === undefined) return null;
  return <span className="lg-pts k-nums">{signed(points)}</span>;
}

/**
 * The head of one column of a row: what this row says that the first row does not (up to three, then
 * "+N more"; the rest are one press away in the row's expansion), and one line counting what it shares
 * with the first row. An empty column says so in words, never with a blank.
 */
export function CellReasons({ tone, items, more, shared, sharedPoints, empty }: {
  tone: ReasonTone;
  items: readonly Reason[];
  more: number;
  shared: number;
  sharedPoints: number | null;
  empty: string;
}) {
  const t = useTranslations("analyzeCohort.layerLedger");
  const phrase = usePhrase();
  if (!items.length && !shared) return <p className="lg-cell-none">{empty}</p>;
  return (
    <ul className="lg-reasons" data-tone={tone}>
      {items.map((r, i) => (
        <li key={i} className="lg-reason">
          <ToneGlyph tone={r.tone} />
          <span className="lg-reason__text">{phrase(r.phrase)}</span>
          <Points points={r.points} />
        </li>
      ))}
      {more > 0 ? <li className="lg-reason lg-reason--more">{phrase({ key: "more", params: { n: more } })}</li> : null}
      {shared > 0 ? (
        <li className="lg-reason lg-reason--shared">
          <span className="lg-shared__eq" aria-hidden>
            =
          </span>
          <span className="lg-reason__text">{t("shared", { n: shared })}</span>
          {sharedPoints != null ? <span className="lg-pts k-nums">{signed(sharedPoints)}</span> : null}
        </li>
      ) : null}
    </ul>
  );
}

/** One reason in full: its phrase, its points, where it came from, and its evidence behind a real button. */
function FullReason({ reason }: { reason: Reason }) {
  const t = useTranslations("analyzeCohort.layerLedger");
  const phrase = usePhrase();
  const [open, setOpen] = useState(false);
  const id = useId();
  const evidence = reason.evidence ?? [];
  return (
    <li className="lg-full">
      <ToneGlyph tone={reason.tone} />
      <div className="lg-full__body">
        <p className="lg-full__line">
          <span className="lg-full__text">{phrase(reason.phrase)}</span>
          <Points points={reason.points} />
        </p>
        <p className="lg-full__from">
          {t("from", { source: t(`source.${reason.source}`) })}
          {evidence.length ? (
            <Button
              variant="link"
              size="sm"
              className="lg-full__ev"
              label={open ? t("evidenceHide") : t("evidence", { n: evidence.length })}
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen((o) => !o)}
            />
          ) : null}
        </p>
        {evidence.length && open ? (
          <ul id={id} className="lg-full__evidence">
            {evidence.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** A whole reason list (the row's expansion): every reason, with a heading that counts them. */
export function FullReasons({ tone, list }: { tone: ReasonTone; list: readonly Reason[] }) {
  const t = useTranslations("analyzeCohort.layerLedger");
  return (
    <section className="lg-fulls" data-tone={tone}>
      <h4 className="lg-fulls__h">
        <ToneGlyph tone={tone} />
        {t(`detail.${tone}`)}
        <span className="lg-fulls__n k-nums">{list.length}</span>
      </h4>
      {list.length ? (
        <ul className="lg-fulls__list">
          {list.map((r, i) => (
            <FullReason key={i} reason={r} />
          ))}
        </ul>
      ) : (
        <p className="lg-cell-none">{t(`detail.none.${tone}`)}</p>
      )}
    </section>
  );
}
