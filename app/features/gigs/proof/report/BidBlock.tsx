"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { clientAsksOf, isKpDraft, proposalMovedOn } from "../../logic/proposal";
import { BidAsks } from "./BidAsks";

// The body of the Summary's "The bid" panel on a proposal-track gig (a freelance bid; its
// heading and lede are summary/GigSummary.tsx's): the operator's working surface for the bid. The
// message to paste on the platform, Copy message, then what to ask the client
// (BidAsks.tsx). When the latest attempt is the draft kp wrote itself from
// the proposal, that draft IS the message: it is proofed here, as the proof slip over the
// galley (`draft`, the same node the "Review the draft" block shows for a persona's draft),
// so the words appear once and every lint note stays pinned beside its paragraph; Approve is
// the sign-off's. A proposal rewritten after that draft (a rewrite writes the file, not a new
// draft) is shown under it as the rewritten message, with how to proof it.

export function BidBlock({ gig, attempt, draft, onFlash }: { gig: Gig; attempt: GigAttempt | null; draft: ReactNode; onFlash: (message: string) => void }) {
  const t = useTranslations("gigs.proposal.bid");
  const to = useTranslations("gigs.outreach");
  const own = isKpDraft(attempt) ? (attempt?.deliverable?.draftText?.trim() ?? "") : "";
  const proposed = gig.proposal?.message.trim() ?? "";
  const moved = own !== "" && proposalMovedOn(gig.proposal, own);
  const asks = clientAsksOf(gig);

  const copy = (text: string) => {
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(() => onFlash(t("copied")), () => onFlash(t("copyFailed")));
    else onFlash(t("copyFailed"));
  };
  const card = (text: string, label?: string) => (
    <div className="msg-card">
      <p className="msg-to">{label ?? to("to", { client: gig.org ?? to("theClient") })}</p>
      <p className="msg-body">{text}</p>
    </div>
  );
  const copyRow = (text: string) => (
    <div className="bid-copy">
      <Button label={t("copy")} icon="copy" variant="secondary" onClick={() => copy(text)} />
      <span className="t-meta">{t("foot")}</span>
    </div>
  );

  return (
    <div className="bid">
      {own ? (
        <>
          {draft}
          {copyRow(own)}
          {moved ? (
            <div className="bid-moved">
              <p className="t-meta">{t("movedOn")}</p>
              {card(proposed, t("newMessage"))}
            </div>
          ) : null}
        </>
      ) : proposed ? (
        <>
          {card(proposed)}
          {copyRow(proposed)}
        </>
      ) : null}
      <BidAsks questions={asks.questions} artifacts={asks.artifacts} />
    </div>
  );
}
