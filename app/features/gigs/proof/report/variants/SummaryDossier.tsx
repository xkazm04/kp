"use client";

import { useTranslations } from "next-intl";
import { BriefText } from "../../panels/BriefText";
import { BidBlock } from "../BidBlock";
import { ReportSection } from "../parts";
import { DecisionSidebar } from "./DecisionSidebar";
import { PlanSeats } from "./PlanSeats";
import { DossierHero } from "./SummaryHero";
import { useSummaryKit, type SummaryProps } from "./useSummaryKit";
import "../../../styles/summary-dossier.css";

// Variant A, "Dossier" (WP13 round 1): the Summary as a DOCUMENT PAGE. The metaphor is an
// editorial dossier on the gig: a set title block (eyebrow, a title of at most 2rem, one lead
// sentence, the rest at body size), then the brief, the plans, the bid and the draft read as
// numbered sections of one document at a 66ch measure, the draft itself a letter on a sheet
// (GalleyLetter.tsx, via DraftTab's `look`). Beside it the sticky decision sidebar as a calm
// "decision card": every move in one place, then the gig's metadata and the brief's provenance.
// Differs from the baseline: no buttons in the hero, no second aside inside the brief, the lead
// never a wall of display type, and every action where the decision is made.

export function SummaryDossier(props: SummaryProps) {
  const t = useTranslations("gigs");
  const kit = useSummaryKit(props);
  const { view, gig, attempt, summary, draft, withdraw, proposalFile, now, attempts, onFlash, onGo } = props;
  const brief = kit.research.brief;
  const { blocks } = kit;
  let n = 0;
  const num = (title: string) => `${++n}. ${title}`;

  return (
    <div className="sm-grid sm--dossier">
      <DecisionSidebar gig={gig} kit={kit} proposalFile={proposalFile} now={now} attempts={attempts} onFlash={onFlash} onGo={onGo} look="card" />
      <article className="rp sm-read" aria-label={t(view === "brief" ? "brief.title" : "report.label")}>
        {view === "brief" ? (
          <div className="sm-doc">
            {brief ? (
              <BriefText brief={brief} withdraw={withdraw} />
            ) : (
              <p className="panel-empty">
                <b>{t("brief.notYet")}.</b> {t("brief.notYetBody")}
              </p>
            )}
          </div>
        ) : (
          <>
            <DossierHero gig={gig} brief={brief} summary={summary} kpDraft={kit.kpDraft} onOpenListing={props.onOpenListing} />
            {brief ? (
              <ReportSection id="brief" title={num(t("summaryProto.secBrief"))}>
                <div className="sm-doc">
                  <BriefText brief={brief} withdraw={withdraw} title={false} dropFirst={summary.kind === "about"} />
                </div>
              </ReportSection>
            ) : null}
            {blocks.plans ? (
              <ReportSection id="plans" title={num(blocks.plans === "accepted" ? t("report.sec.accepted") : t("report.sec.plans"))}>
                <PlanSeats gig={gig} kit={kit} />
              </ReportSection>
            ) : null}
            {blocks.bid ? (
              <ReportSection id="bid" title={num(t("proposal.bid.title"))} lede={blocks.draftInBid ? t("proposal.bid.ledeOwn") : t("proposal.bid.lede")}>
                <BidBlock gig={gig} attempt={attempt} draft={blocks.draftInBid ? draft : null} onFlash={onFlash} />
              </ReportSection>
            ) : null}
            {blocks.draft ? (
              <ReportSection id="draft" title={num(t("report.sec.draft"))}>
                {draft}
              </ReportSection>
            ) : null}
          </>
        )}
      </article>
    </div>
  );
}
