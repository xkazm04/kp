"use client";

import { useTranslations } from "next-intl";
import { Mark } from "@/app/_components/kit";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import { proposalHasFile } from "../../logic/proposal";
import type { GigFileState } from "../report/useGigFile";
import type { PlanGate } from "./BeforeDispatch";

// ---------------------------------------------------------------------------
// A freelance bid nobody drafted yet: prepare the proposal (never dispatch)
// ---------------------------------------------------------------------------
//
// The proposal track (logic/proposal.ts) has no agent to dispatch: the primary move is
// Prepare the proposal (POST /api/gigs/[id]/proposal, the same door as the Summary's row,
// through the proof's shared file state). An accepted plan is the better input, so the gate
// reads the plans like dispatch did - but a missing plan only adds the brief-alone note, it
// never blocks. Once the proposal lands kp writes the bid as the gig's draft, and the desk
// takes over. Also shown when kp's last draft was sent back or failed: preparing again is the
// way forward (there is no agent to re-dispatch).

export function PrepareProposal({
  gig,
  file,
  planGate,
  again,
  onDecline,
  onOpenPlans,
  onFlash,
}: {
  gig: Gig;
  file: GigFileState<GigProposal>;
  planGate: PlanGate;
  /** The last draft was sent back or failed: say so above the move. */
  again: boolean;
  onDecline: () => void;
  onOpenPlans: () => void;
  onFlash: (message: string) => void;
}) {
  const t = useTranslations("gigs");
  const { writing, busy, error, write } = file;
  const qualified = gig.status === "qualified";
  const hasFile = proposalHasFile(file.file);

  async function prepare() {
    if (await write()) onFlash(t("proposal.signoff.flash"));
  }

  return (
    <div className="acts">
      <p className="hint">{again ? t("proposal.signoff.again") : t("proposal.signoff.why")}</p>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {writing ? (
        <p className="hint so-writing" role="status">
          <Mark kind="wait" /> {t("proposal.signoff.writing")}
        </p>
      ) : qualified || again ? (
        <button
          type="button"
          className="btn affirm block wrap"
          disabled={busy || !gig.brief || planGate === "loading"}
          aria-describedby={planGate === "missing" ? `gate-${gig.id}` : undefined}
          onClick={() => void prepare()}
        >
          {hasFile ? t("proposal.hero.rewrite") : t("proposal.hero.prepare")}
        </button>
      ) : (
        <p className="hint">
          <b>{t("triageView.belowBar")}.</b> {t("proposal.signoff.belowBarHow")}
        </p>
      )}
      {!gig.brief ? (
        <p className="hint">{t("proposal.hero.needsBrief")}</p>
      ) : !writing && (qualified || again) && planGate === "missing" ? (
        <p className="hint" id={`gate-${gig.id}`}>
          <b>{t("proposal.signoff.noPlan")}.</b> {t("proposal.signoff.noPlanBody")}{" "}
          <button type="button" className="linkbtn" onClick={onOpenPlans}>
            {t("plans.openPlans")}
          </button>
        </p>
      ) : !writing && (qualified || again) && planGate === "loading" ? (
        <p className="hint" role="status">
          {t("plans.gateChecking")}
        </p>
      ) : null}
      {!again ? (
        <button type="button" className="btn ghost danger block" disabled={busy} onClick={onDecline}>
          {t("triageView.decline")}
        </button>
      ) : null}
    </div>
  );
}
