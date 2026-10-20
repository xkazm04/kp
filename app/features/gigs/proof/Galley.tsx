"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../data/useGigsFormat";
import { draftParagraphs, type MarginNote } from "../logic/galley";
import type { SourceRow } from "../logic/wire";
import { UntrustedText } from "../shared/UntrustedText";
import type { useLintText } from "../shared/useLintText";
import { useAlignNotes } from "./galleyAlign";
import { NoteText, noteClass } from "./GalleyNote";
import { MarkedText } from "./MarkedText";

// The Draft tab's sheet: the draft set as it would be sent, paragraphs numbered, every phrase
// a note names underlined (MarkedText) and the note pinned in the margin beside it - a lint
// finding in amber, a reviewer's note in coral. With no draft, a stamp that says why.

/** The galley: the draft as it would be sent, or a stamp saying why there is none. */
export function Galley({
  gig,
  attempt,
  source,
  specialistName,
  now,
  paras,
  pinned,
  lintText,
  reviewBy,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  specialistName: string | null;
  now: Date;
  paras: ReturnType<typeof draftParagraphs>;
  pinned: MarginNote[];
  lintText: ReturnType<typeof useLintText>;
  reviewBy: string;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useAlignNotes(sheetRef, paras, pinned);
  const stamp = (tone: "" | "calm" | "moss", s1: string, s2: string) => (
    <div className="galley">
      <div className="sheet">
        <div className="stamp-wrap">
          <div className={`stamp ${tone}`} role="note">
            <span className="s1">{s1}</span>
            <span className="s2">{s2}</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (gig.status === "suspect") {
    return (
      <div className="galley">
        <div className="sheet">
          <div className="stamp-wrap tight">
            <div className="stamp" role="note">
              <span className="s1">{t("proof.stampQuarantined")}</span>
              <span className="s2">{gig.suspectReasons.map((r) => fmt.suspect(r)).join(" · ")}</span>
            </div>
          </div>
          <div className="sheet-pad">
            <UntrustedText gig={gig} source={source} />
          </div>
        </div>
      </div>
    );
  }
  if (!attempt) {
    if (gig.status === "qualified") return stamp("calm", t("proof.stampNotWritten"), specialistName ? t("proof.stampQualified", { name: specialistName }) : t("proof.stampQualifiedNone"));
    if (gig.status === "new") return stamp("calm", t("proof.stampNotQualified"), t("proof.stampNew"));
    if (gig.status === "declined" || gig.status === "withdrawn" || gig.status === "expired") return stamp("calm", fmt.status(gig.status), t("proof.stampOff"));
    return stamp("calm", fmt.status(gig.status), t("proof.stampNoProof"));
  }
  if (attempt.status === "running" || attempt.status === "dispatched") {
    return stamp("moss", t("proof.stampRunning"), t("proof.stampRunningBody", { when: fmt.relative(attempt.createdAt, now) ?? "" }));
  }
  if (attempt.status === "revision_requested") return stamp("calm", t("agentView.revisionTitle"), t("agentView.revisionBody"));
  if (attempt.status === "failed" || !attempt.deliverable) {
    return stamp("", t("proof.stampNoDeliverable"), t("agentView.failedReason", { reason: attempt.fallbackReason ?? t("agentView.noReason") }));
  }
  const dl = attempt.deliverable;
  if (attempt.status === "sent" || attempt.status === "discarded" || !["drafted", "approved"].includes(attempt.status)) {
    // Out of the desk's hands: the draft as it went (or would have gone), unmarked.
    return (
      <div className="galley">
        <div className="sheet">
          <div className="rh">
            <span className="caps dim">{fmt.attemptStatus(attempt.status)}</span>
            <span className="t-meta">{fmt.dateTime(attempt.sentAt ?? attempt.updatedAt)}</span>
          </div>
          {draftParagraphs(dl.draftText).map((p, i) => (
            <div key={i} className="para">
              <span className="pn">¶{i + 1}</span>
              <div className="tx">{p.text}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const words = dl.draftText.trim().split(/\s+/).filter(Boolean).length;
  return (
    <div className="galley">
      <div className="sheet" ref={sheetRef}>
        <div className="rh">
          <span className="caps dim">{t("proof.draftOf", { date: fmt.dateTime(attempt.createdAt) })}</span>
          <span className="t-meta">{t("proof.size", { paragraphs: paras.length, words })}</span>
        </div>
        {paras.length ? (
          paras.map((p, i) => {
            const mine = pinned.filter((n) => n.para === i);
            return (
              <div key={i} className="para" id={`gd-p${i + 1}`}>
                <span className="pn" aria-label={t("proof.paragraph", { n: i + 1 })}>
                  ¶{i + 1}
                </span>
                <div className="tx">
                  <MarkedText text={p.text} notes={mine} />
                </div>
                <div className="mnotes">
                  {mine.map((n) => (
                    <div key={n.key} id={`gd-note-${n.key}`} tabIndex={-1} className={noteClass(n)}>
                      <NoteText note={n} lintText={lintText} reviewBy={reviewBy} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="stamp-wrap">
            <div className="stamp" role="note">
              <span className="s1">{t("proof.stampEmpty")}</span>
              <span className="s2">{t("proof.stampEmptyBody")}</span>
            </div>
          </div>
        )}
        {dl.artifacts.length ? (
          <div className="para">
            <span className="pn" aria-hidden>
              ✉
            </span>
            <div className="encl">
              <span className="caps dim">{t("proof.enclosures", { count: dl.artifacts.length })}</span>
              {dl.artifacts.map((a, i) => (
                <span key={i}>
                  {a.title || a.ref} <code>{a.ref}</code>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
