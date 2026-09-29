"use client";

import { useTranslations } from "next-intl";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { draftParagraphs } from "../logic/galley";
import type { SourceRow } from "../logic/wire";
import { useDoubts } from "../shared/doubts";
import { useGigsFormat } from "../data/useGigsFormat";
import type { DeadlineCell, RewardCell } from "./useGigCells";

// The front page's lead (GigsFront.tsx): the single most urgent proof, with what to doubt
// about it (the first two stops or doubts) and its opening paragraphs - or the listing's
// opening when no draft came back yet.

export function FrontLead({
  gig,
  attempt,
  source,
  niche,
  now,
  reward,
  deadline,
  onOpen,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  niche: string | null;
  now: Date;
  reward: RewardCell;
  deadline: DeadlineCell;
  onOpen: () => void;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const doubtsOf = useDoubts();
  const { doubts } = doubtsOf(gig, attempt, source, now);
  const top = doubts.filter((d) => d.sev !== "note").slice(0, 2);
  const draft = attempt?.deliverable?.draftText ?? "";
  const paras = draftParagraphs(draft);
  const hasDraft = draft.trim().length > 40;
  const stage = gig.status === "in_review" ? t("front.col.ready") : gig.status === "drafted" ? t("front.col.proof") : gig.status === "suspect" ? t("front.col.quar") : fmt.status(gig.status);

  return (
    <article className="lead" aria-label={t("front.leadLabel")}>
      <div>
        <div className="kicker">
          <span className="caps coral">{t("front.lead")}</span>
          <span className="caps dim">{stage}</span>
        </div>
        <button type="button" className="title" onClick={onOpen}>
          {gig.title}
        </button>
        <div className="facts">
          <span>{fmt.arena(gig.arena)}</span>
          <span className="strong">{reward(gig, true)}</span>
          <span>{deadline(gig, true)}</span>
          {niche ? <span>{niche}</span> : null}
        </div>
        {top.length ? (
          <div className="doubts">
            {top.map((d) => (
              <div key={d.key} className={`mnote-lite ${d.sev}`}>
                <i className={`mk ${d.sev}`} aria-hidden />
                <div>
                  <div className={`l${d.sev === "stop" ? " coral" : ""}`}>
                    <span className="sr-only">{t(`slip.sev.${d.sev}`)}: </span>
                    {d.label}
                  </div>
                  {d.detail ? <div className="d">{d.detail}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="galley-strip">
        {hasDraft ? (
          paras.slice(0, 2).map((p, i) => (
            <div key={i} className="gal-p">
              <span className="pn" aria-hidden>
                ¶{i + 1}
              </span>
              <p>{p.text}</p>
            </div>
          ))
        ) : (
          <div className="gal-p">
            <span className="pn" aria-hidden>
              —
            </span>
            <p>{gig.bodyText.slice(0, 420)}</p>
          </div>
        )}
        <div className="more">
          <span className="t-meta">
            {hasDraft
              ? t("front.leadSize", { paragraphs: paras.length, enclosures: attempt?.deliverable?.artifacts.length ?? 0 })
              : t("front.leadListing")}
          </span>
          <button type="button" className="btn primary" onClick={onOpen}>
            {t("front.readProof")}
          </button>
        </div>
      </div>
    </article>
  );
}
