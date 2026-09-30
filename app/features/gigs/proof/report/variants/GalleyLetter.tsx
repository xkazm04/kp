"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useGigsFormat } from "../../../data/useGigsFormat";
import { Galley } from "../../Galley";
import { useAlignNotes } from "../../galleyAlign";
import { draftOnDesk, NoteText, noteClass } from "../../GalleyNote";
import { MarkedText } from "../../MarkedText";
import { hostOf } from "./SummaryHero";

// Dossier's galley: the draft as a LETTER on a sheet. An address line ("To <client> · via
// <platform>") and the date and size under it, then the body in the reading face at
// 1.0625rem/1.7 held to a 66ch measure, paragraph numbers in a narrow gutter, and each note
// as a numbered footnote card under the paragraph it annotates (in the margin only where the
// sheet is wide enough to hold a real one, styles/summary-dossier.css). Every state that is not
// a draft on the desk (a stamp, a sent draft) is the baseline galley's (Galley.tsx).

export function GalleyLetter(props: Parameters<typeof Galley>[0]) {
  const { gig, attempt, paras, pinned, lintText, reviewBy } = props;
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useAlignNotes(sheetRef, paras, pinned);
  const dl = attempt?.deliverable ?? null;
  if (!attempt || !dl || !draftOnDesk(gig.status, attempt) || paras.length === 0) return <Galley {...props} />;
  const words = dl.draftText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="galley sm-letter">
      <div className="sheet" ref={sheetRef}>
        <header className="sm-letter-head">
          <p className="sm-letter-to">{t("summaryProto.letterTo", { client: gig.org ?? t("outreach.theClient"), platform: hostOf(gig.url) })}</p>
          <p className="t-meta">
            {t("proof.draftOf", { date: fmt.dateTime(attempt.createdAt) })} · {t("proof.size", { paragraphs: paras.length, words })}
          </p>
        </header>
        {paras.map((p, i) => {
          const mine = pinned.filter((n) => n.para === i);
          return (
            <div key={i} className="para" id={`gd-p${i + 1}`}>
              <span className="pn" aria-label={t("proof.paragraph", { n: i + 1 })}>
                {i + 1}
              </span>
              <div className="tx">
                <MarkedText text={p.text} notes={mine} />
              </div>
              {mine.length ? (
                <div className="mnotes">
                  {mine.map((n) => (
                    <div key={n.key} id={`gd-note-${n.key}`} tabIndex={-1} className={noteClass(n)}>
                      <NoteText note={n} lintText={lintText} reviewBy={reviewBy} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {dl.artifacts.length ? (
          <footer className="sm-letter-encl">
            <p className="caps dim">{t("proof.enclosures", { count: dl.artifacts.length })}</p>
            <ul>
              {dl.artifacts.map((a, i) => (
                <li key={i}>
                  {a.title || a.ref} <code>{a.ref}</code>
                </li>
              ))}
            </ul>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
