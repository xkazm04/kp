"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import type { MoveId } from "../../../logic/moves";
import { reportAnchor, type ReportSection } from "../../../logic/report";
import { BriefText } from "../../panels/BriefText";
import { BidBlock } from "../BidBlock";
import { DecisionSidebar } from "./DecisionSidebar";
import { PlanSeats } from "./PlanSeats";
import { WorkbenchHead } from "./SummaryHero";
import { useSummaryKit, type SummaryProps } from "./useSummaryKit";
import "../../../styles/summary-workbench.css";

// Variant B, "Workbench" (WP13 round 1): the Summary as an OPERATIONAL BENCH. Denser and
// scannable: a compact header (title, one line of what it is, the key facts as pairs), then
// the reading column as collapsible panels - Brief, Plans, The bid / Draft - with the one the
// gig's next move points at open; the draft is a compose view like a mail client
// (GalleyCompose.tsx). The sticky sidebar is a "control panel": the next move pinned on top,
// every other move a full-width button in a vertical stack. A jump into a closed panel (the
// Moves block, the sign-off's "go to the plans") opens it first.

type Fold = "brief" | "plans" | "bid" | "draft";
const OPEN_FOR: Partial<Record<MoveId, Fold>> = { research: "brief", generatePlans: "plans", goPlans: "plans", goDraft: "draft", goBid: "bid", openProposal: "bid", prepareProposal: "plans" };

function Panel({ id, title, state, open, onOpen, children }: { id: Fold; title: string; state?: string; open: boolean; onOpen: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className="sm-fold" open={open} onToggle={(e) => onOpen(e.currentTarget.open)}>
      {/* A jump focuses the summary (it carries the section's anchor): focus opens the panel. */}
      <summary id={reportAnchor(id)} onFocus={() => (open ? undefined : onOpen(true))}>
        <span className="sm-fold-t">{title}</span>
        {state ? <span className="sm-fold-s">{state}</span> : null}
      </summary>
      <div className="sm-fold-body">{children}</div>
    </details>
  );
}

export function SummaryWorkbench(props: SummaryProps) {
  const t = useTranslations("gigs");
  const kit = useSummaryKit(props);
  const { view, gig, attempt, summary, draft, withdraw, proposalFile, now, attempts, onFlash } = props;
  const brief = kit.research.brief;
  const { blocks } = kit;
  const first: Fold = (kit.next && OPEN_FOR[kit.next]) || (blocks.draftInBid || blocks.bid ? "bid" : blocks.draft ? "draft" : "brief");
  const [open, setOpen] = useState<Record<Fold, boolean>>(() => ({ brief: first === "brief", plans: first === "plans", bid: first === "bid", draft: first === "draft" }));
  const set = (f: Fold) => (v: boolean) => setOpen((o) => (o[f] === v ? o : { ...o, [f]: v }));
  const onGo = (s: ReportSection) => {
    if (s === "brief" || s === "plans" || s === "bid" || s === "draft") set(s)(true);
    props.onGo(s);
  };
  const plansState = kit.view.accepted ? t("report.choose.acceptedLine", { seat: planSeatLabel(kit.view.accepted) }) : kit.view.ready ? t("plans.readyTip", { count: kit.view.ready }) : undefined;

  return (
    <div className="sm-grid sm--workbench">
      <DecisionSidebar gig={gig} kit={kit} proposalFile={proposalFile} now={now} attempts={attempts} onFlash={onFlash} onGo={onGo} look="panel" />
      <article className="rp sm-read" aria-label={t(view === "brief" ? "brief.title" : "report.label")}>
        {view === "brief" ? (
          <div className="sm-wb-sheet">
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
            <WorkbenchHead gig={gig} brief={brief} summary={summary} kpDraft={kit.kpDraft} now={now} onOpenListing={props.onOpenListing} />
            <div className="sm-folds">
              {blocks.bid ? (
                <Panel id="bid" title={t("proposal.bid.title")} state={blocks.draftInBid ? t("summaryProto.bidOwn") : undefined} open={open.bid} onOpen={set("bid")}>
                  <p className="rp-lede">{blocks.draftInBid ? t("proposal.bid.ledeOwn") : t("proposal.bid.lede")}</p>
                  <BidBlock gig={gig} attempt={attempt} draft={blocks.draftInBid ? draft : null} onFlash={onFlash} />
                </Panel>
              ) : null}
              {blocks.draft ? (
                <Panel id="draft" title={t("report.sec.draft")} open={open.draft} onOpen={set("draft")}>
                  {draft}
                </Panel>
              ) : null}
              {blocks.plans ? (
                <Panel id="plans" title={blocks.plans === "accepted" ? t("report.sec.accepted") : t("report.sec.plans")} state={plansState} open={open.plans} onOpen={set("plans")}>
                  <PlanSeats gig={gig} kit={kit} />
                </Panel>
              ) : null}
              <Panel id="brief" title={t("summaryProto.secBrief")} state={brief?.category} open={open.brief} onOpen={set("brief")}>
                {brief ? (
                  <BriefText brief={brief} withdraw={withdraw} title={false} />
                ) : (
                  <p className="panel-empty">
                    <b>{t("brief.notYet")}.</b> {t("brief.notYetBody")}
                  </p>
                )}
              </Panel>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
