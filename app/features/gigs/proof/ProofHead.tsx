"use client";

import { useTranslations } from "next-intl";
import type { Gig } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../data/useGigsFormat";
import { trackOf } from "../logic/proposal";

// The proof's head on every tab but Summary (whose report opens with its own): the stage in
// the front page's words (coral when the next move is the operator's) and the niche, then
// the title. And the stamp a proof shows when its gig is gone.

/** The gig's stage in the front page's words, and whether the next move is the operator's
 *  (the head's kicker, the report's eyebrow, the sign-off's state). A freelance bid (the
 *  proposal track) says what is on the desk: "Proposal to proof", "Bid ready to send". */
export function useStage(gig: Gig): { stage: string; waits: boolean } {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const bid = trackOf(gig) === "proposal";
  const waits = gig.status === "in_review" || gig.status === "drafted" || gig.status === "suspect" || gig.status === "sent";
  const stage =
    gig.status === "in_review"
      ? bid
        ? t("proposal.stage.ready")
        : t("front.col.ready")
      : gig.status === "drafted"
        ? bid
          ? t("proposal.stage.proof")
          : t("front.col.proof")
        : gig.status === "suspect"
          ? t("front.col.quar")
          : fmt.status(gig.status);
  return { stage, waits };
}

export function ProofHead({ gig, nicheLabel }: { gig: Gig; nicheLabel: string | null }) {
  const { stage, waits } = useStage(gig);
  return (
    <header className="proof-head">
      <div className="kicker">
        <span className={`caps ${waits ? "coral" : "dim"}`}>{stage}</span>
        {nicheLabel ? <span className="caps dim">{nicheLabel}</span> : null}
      </div>
      <h2>{gig.title}</h2>
    </header>
  );
}

export function ProofNotFound() {
  const t = useTranslations("gigs");
  return (
    <div className="stamp-wrap">
      <div className="stamp calm">
        <span className="s1">{t("detail.notFoundTitle")}</span>
        <span className="s2">{t("proof.notFound")}</span>
      </div>
    </div>
  );
}
