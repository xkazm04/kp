"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigAttempt, GigProposal } from "@/app/_lib/gigs/types";
import { planView } from "../../logic/plans";
import { isKpDraft, trackOf } from "../../logic/proposal";
import { reportAnchor, summaryBlocks } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import type { AfterWrite } from "../../logic/wire";
import type { PlansState } from "../panels/usePlans";
import { BidBlock } from "./BidBlock";
import { ReportSection } from "./parts";
import { ReportChoose } from "./ReportChoose";
import { ReportHero } from "./ReportHero";
import type { GigFileState } from "./useGigFile";

// The proof's Summary tab: a quick overview, the long read one click away. The operator's
// call (2026-09-30): the full report is an HTML file the model writes and rewrites as the
// gig moves, opened in the browser; the app keeps
//   - the HERO: eyebrow, title, lead, the full report's row (open it, Regenerate), the
//     listing's language;
//   - the BRIEF: the Brief tab's own panel (panels/BriefPanel.tsx) with its ONE metadata
//     sidebar (meta/GigMeta.tsx: the listing's URL, the gig's id, the figures, the report
//     file), so the gig's metadata reads the same in both places;
//   - then compact working blocks only while they apply: "Choose a plan" (seat cards with
//     Accept; one line once accepted), on a freelance bid "The bid" (the message, the
//     questions and artifacts to ask; kp's own draft proofed inside it, BidBlock.tsx), and
//     "Review the draft" (the proof slip over the galley).
// Progress stays on the Pairing tab and the record on History; evidence lives in the file.

export function GigReport({
  gig,
  attempt,
  summary,
  plansState,
  proposalFile,
  brief,
  draft,
  onChanged,
  onFlash,
  onOpenTab,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  summary: SummaryText;
  plansState: PlansState;
  /** The client proposal's file state (the proof owns it: the sign-off writes it too). */
  proposalFile: GigFileState<GigProposal>;
  brief: ReactNode;
  draft: ReactNode;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenTab: (tab: "listing") => void;
}) {
  const t = useTranslations("gigs.report");
  const tp = useTranslations("gigs.proposal.bid");
  const view = useMemo(() => planView(plansState.plans), [plansState.plans]);
  const bidTrack = trackOf(gig) === "proposal";
  const kpDraft = isKpDraft(attempt);
  const blocks = summaryBlocks({
    brief: gig.brief !== null,
    plans: plansState.plans === null ? null : (view.shown?.rows.length ?? 0),
    accepted: view.accepted !== null,
    draft: !!attempt?.deliverable?.draftText?.trim(),
    proposalTrack: bidTrack,
    proposal: !!gig.proposal?.message.trim(),
    kpDraft,
  });

  return (
    <article className="rp" aria-label={t("label")}>
      <ReportHero
        gig={gig}
        summary={summary}
        proposal={bidTrack ? { file: proposalFile, planAccepted: view.accepted !== null, kpDraft } : null}
        onOpenListing={() => onOpenTab("listing")}
        onChanged={onChanged}
      />

      {/* The brief panel names itself (its categories and title, or "Research brief" with
          Research while there is none): no second heading over it. */}
      <div className="rp-brief" id={reportAnchor("brief")}>
        {brief}
      </div>

      {blocks.plans ? (
        <ReportSection id="plans" title={blocks.plans === "accepted" ? t("sec.accepted") : t("sec.plans")}>
          <ReportChoose gig={gig} plansState={plansState} onFlash={onFlash} />
        </ReportSection>
      ) : null}

      {blocks.bid ? (
        <ReportSection id="bid" title={tp("title")} lede={blocks.draftInBid ? tp("ledeOwn") : tp("lede")}>
          <BidBlock gig={gig} attempt={attempt} draft={blocks.draftInBid ? draft : null} onFlash={onFlash} />
        </ReportSection>
      ) : null}

      {blocks.draft ? (
        <ReportSection id="draft" title={t("sec.draft")}>
          {draft}
        </ReportSection>
      ) : null}
    </article>
  );
}
