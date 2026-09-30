"use client";

import { useTranslations } from "next-intl";
import { useGigsFormat } from "../../data/useGigsFormat";
import { Galley } from "../Galley";
import { draftOnDesk, NoteText, noteClass } from "../GalleyNote";
import { MarkedText } from "../MarkedText";
import { hostOf } from "./SummaryHead";

// The Summary's galley: the draft as a COMPOSE view, the way a mail client shows a message about
// to go. A To / Subject header, the body in the sans at reading size, enclosures as chips, and
// every finding highlighted INLINE (a wash on the phrase, its letter after it) with the
// numbered list of findings beside the text on a wide column and under it on a narrow one
// (styles/summary.css). The list items keep the margin notes' ids, so the proof slip's "go to
// note" lands on them. Every state that is not a draft on the desk (a stamp, a sent draft) is
// the full galley's (Galley.tsx).

const baseName = (ref: string) => ref.split(/[\\/]/).filter(Boolean).pop() ?? ref;

export function GalleyCompose(props: Parameters<typeof Galley>[0]) {
  const { gig, attempt, paras, pinned, lintText, reviewBy } = props;
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const dl = attempt?.deliverable ?? null;
  if (!attempt || !dl || !draftOnDesk(gig.status, attempt) || paras.length === 0) return <Galley {...props} />;
  const words = dl.draftText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="galley sm-compose">
      <dl className="sm-compose-head">
        <div>
          <dt>{t("summary.composeTo")}</dt>
          <dd>
            {gig.org ?? t("outreach.theClient")} <span className="t-meta">{t("summary.via", { platform: hostOf(gig.url) })}</span>
          </dd>
        </div>
        <div>
          <dt>{t("summary.composeSubject")}</dt>
          <dd>{t("summary.composeRe", { title: gig.brief?.title ?? gig.title })}</dd>
        </div>
        <div>
          <dt>{t("summary.composeDraft")}</dt>
          <dd className="t-meta">
            {fmt.dateTime(attempt.createdAt)} · {t("proof.size", { paragraphs: paras.length, words })}
          </dd>
        </div>
      </dl>
      <div className="sm-compose-split">
        <div className="sm-compose-body">
          {paras.map((p, i) => (
            <p key={i} id={`gd-p${i + 1}`} className="sm-compose-p">
              <MarkedText text={p.text} notes={pinned.filter((n) => n.para === i)} />
            </p>
          ))}
          {dl.artifacts.length ? (
            <div className="sm-encl" aria-label={t("proof.enclosures", { count: dl.artifacts.length })} role="group">
              {dl.artifacts.map((a, i) => (
                <span key={i} className="sm-encl-chip">
                  <b>{a.title || baseName(a.ref)}</b>
                  <code>{baseName(a.ref)}</code>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <section className="sm-findings" aria-label={t("summary.findings")}>
          <p className="caps dim">
            {t("summary.findings")} <span className="sub-n">{pinned.length}</span>
          </p>
          {pinned.length ? (
            <ol>
              {pinned.map((n) => (
                <li key={n.key} id={`gd-note-${n.key}`} tabIndex={-1} className={noteClass(n)}>
                  <NoteText note={n} lintText={lintText} reviewBy={reviewBy} />
                  <span className="sm-finding-at">{t("proof.paragraph", { n: n.para + 1 })}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="t-meta">{t("summary.findingsNone")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
