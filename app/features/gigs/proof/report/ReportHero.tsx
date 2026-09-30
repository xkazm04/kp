"use client";

import { useTranslations } from "next-intl";
import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigProposal } from "@/app/_lib/gigs/types";
import { useGigsFormat } from "../../data/useGigsFormat";
import { firstClause, leadOf, listingOpening, reportAnchor } from "../../logic/report";
import type { SummaryText } from "../../logic/summary";
import type { AfterWrite } from "../../logic/wire";
import { ListingLanguage } from "../../shared/ListingLanguage";
import { useStage } from "../ProofHead";
import { Callout } from "./parts";
import { ProposalActions } from "./ProposalActions";
import { ReportActions } from "./ReportActions";
import type { GigFileState } from "./useGigFile";

// Section 1, the gig: an eyebrow (arena · gig type · stage), the title set large in the
// serif, the lead - the deliverable's summary once a draft exists, else the brief's "What
// the gig is" - with a highlighter on its first clause and its points under it, the
// listing's language when it is not English (and its English translation one click away),
// the full report's row (open it, Regenerate) - and on a freelance bid the client proposal's
// row under it (ProposalActions.tsx) - and a callout when the work is not wholly digital. The figures live in the metadata sidebar beside the brief (meta/GigMeta.tsx), not
// here. A gig nobody researched yet leads with the listing's opening, marked as the
// stranger's words.

export function ReportHero({
  gig,
  summary,
  proposal,
  onOpenListing,
  onChanged,
}: {
  gig: Gig;
  summary: SummaryText;
  /** The client proposal's file state, whether a plan is accepted, and whether the draft is
   *  kp's own (its summary is the proposal's): proposal track only. */
  proposal: { file: GigFileState<GigProposal>; planAccepted: boolean; kpDraft: boolean } | null;
  onOpenListing: () => void;
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { stage, waits } = useStage(gig);
  const brief = gig.brief;
  const { lead, points } = summary.kind === "listing" ? { lead: "", points: [] } : leadOf(summary.text);
  const [head, rest] = firstClause(lead);
  const kind = brief?.workKind === "mixed" || brief?.workKind === "physical" ? brief.workKind : null;

  return (
    <header className="rp-hero">
      <p className="rp-eyebrow">
        <span>{fmt.arena(gig.arena)}</span>
        <span aria-hidden> · </span>
        <span>{t(`lanes.type.${gigTypeOf(gig)}`)}</span>
        <span aria-hidden> · </span>
        <span className={waits ? "is-waits" : undefined}>{stage}</span>
      </p>
      <h2 id={reportAnchor("gig")} tabIndex={-1} className="rp-title">
        {brief?.title ?? gig.title}
      </h2>
      {brief?.title && brief.title !== gig.title ? <p className="rp-was">{t("report.hero.listedAs", { title: gig.title })}</p> : null}

      {summary.kind === "listing" ? (
        <div className="rp-opening">
          <p className="rp-kicker">{t("report.hero.opening")}</p>
          <p className="rp-opening-text">{listingOpening(summary.text)}</p>
          <button type="button" className="linkbtn" onClick={onOpenListing}>
            {t("report.hero.wholeListing")}
          </button>
        </div>
      ) : (
        <>
          <p className="rp-lead">
            <mark className="rp-hl">{head}</mark>
            {rest}
          </p>
          {points.length ? (
            <ul className="rp-points">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          <p className="rp-lead-src">{summary.kind !== "summary" ? t("report.hero.fromBrief") : proposal?.kpDraft ? t("proposal.hero.fromProposal") : t("report.hero.fromDraft")}</p>
        </>
      )}

      <ReportActions gig={gig} onChanged={onChanged} />
      {proposal ? <ProposalActions gig={gig} file={proposal.file} planAccepted={proposal.planAccepted} /> : null}
      <ListingLanguage brief={brief} />
      {kind ? (
        <Callout tone={kind === "physical" ? "coral" : "amber"} label={t(`report.hero.work.${kind}`)}>
          <p>{brief?.workKindReason?.trim() || t("report.hero.work.noReason")}</p>
        </Callout>
      ) : null}
    </header>
  );
}
