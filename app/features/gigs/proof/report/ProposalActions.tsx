"use client";

import { useTranslations } from "next-intl";
import { Button, KitIcon, Mark } from "@/app/_components/kit";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import { proposalBasisNote, proposalHasFile } from "../../logic/proposal";
import { useFallbackWhy, type GigFileState } from "./useGigFile";

// The hero's second row on a proposal-track gig (a freelance bid, logic/proposal.ts): the
// client proposal kp writes instead of building anything - an HTML page the client can
// receive, with no internal figures. Open it (GET /api/gigs/[id]/proposal, sandboxed, a new
// tab), Download it (?download=1), Prepare / Rewrite it (POST, 202), and its state: Writing
// with the breathing mark while the shared file hook re-reads the gig every 5 s, or why the
// last write failed. The note under the row says when it is (or will be) written from the
// brief alone. What it covers and where it is on disk: the metadata sidebar.

export function ProposalActions({ gig, file, planAccepted }: { gig: Gig; file: GigFileState<GigProposal>; planAccepted: boolean }) {
  const t = useTranslations("gigs.proposal.hero");
  const why = useFallbackWhy();
  const { file: proposal, writing, busy, error, write } = file;
  const hasFile = proposalHasFile(proposal);
  const note = proposalBasisNote(proposal, planAccepted);
  const href = `/api/gigs/${encodeURIComponent(gig.id)}/proposal`;
  const state = writing ? "writing" : !proposal ? "none" : proposal.status;

  return (
    <div className="rp-acts rp-acts--proposal">
      {hasFile ? (
        <>
          <a className="k-btn k-btn--primary" href={href} target="_blank" rel="noopener noreferrer">
            <KitIcon name="open" />
            {t("open")}
          </a>
          <a className="k-btn k-btn--secondary" href={`${href}?download=1`} download>
            <KitIcon name="down" />
            {t("download")}
          </a>
        </>
      ) : null}
      <Button
        label={hasFile ? t("rewrite") : t("prepare")}
        tip={gig.brief ? t("tip") : t("needsBrief")}
        variant={hasFile ? "secondary" : "primary"}
        loading={busy}
        loadingLabel={t("asking")}
        disabled={!gig.brief || writing}
        onClick={() => void write()}
      />
      {state === "writing" ? (
        <span className="rp-acts-state is-writing" role="status">
          <Mark kind="wait" />
          {hasFile ? t("writing") : t("firstWriting")}
        </span>
      ) : state === "none" ? (
        <span className="rp-acts-state">{gig.brief ? t("none") : t("needsBrief")}</span>
      ) : null}
      {state === "failed" ? (
        <p role="alert" className="rp-acts-fail">
          {t("failed", { reason: why(proposal?.fallbackReason ?? null) })}
        </p>
      ) : null}
      {note && gig.brief && !writing ? <p className="rp-acts-note">{t(`basis.${note}`)}</p> : null}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
