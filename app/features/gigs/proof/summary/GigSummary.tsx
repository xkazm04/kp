"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { planSeatLabel } from "@/app/_lib/gigs/plan-seats";
import type { MoveId } from "../../logic/moves";
import { reportAnchor, type ReportSection } from "../../logic/report";
import { BriefText } from "../panels/BriefText";
import { BidBlock } from "../report/BidBlock";
import { DecisionSidebar } from "./DecisionSidebar";
import { PlanSeats } from "./PlanSeats";
import { SummaryHead } from "./SummaryHead";
import { useSummaryKit, type SummaryProps } from "./useSummaryKit";
import "../../styles/summary.css";

// The proof's Summary tab AND its Brief tab (the layout the operator picked on 2026-09-30, the
// /prototype method): a two-column grid in the proof column, the reading column beside the
// sticky decision sidebar (DecisionSidebar.tsx: every move in one place, then the gig's
// metadata and the brief's provenance). On the Summary the reading column is a compact header
// (SummaryHead.tsx) over folding panels - The bid, The draft, Plans, The brief - with the one
// the gig's next move points at open; the draft is a compose view (GalleyCompose.tsx, via
// DraftTab). On the Brief tab it is the brief itself on a sheet. A jump into a closed panel (the
// Moves block, the sign-off's "go to the plans", a slip link) opens it first.

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

function NoBrief() {
  const t = useTranslations("gigs.brief");
  return (
    <p className="panel-empty">
      <b>{t("notYet")}.</b> {t("notYetBody")}
    </p>
  );
}

export function GigSummary(props: SummaryProps) {
  const t = useTranslations("gigs");
  const kit = useSummaryKit(props);
  const { view, gig, attempt, summary, draft, withdraw, proposalFile, now, attempts, onFlash } = props;
  const brief = kit.research.brief;
  const { blocks } = kit;
  const shown: Record<Fold, boolean> = { bid: !!blocks.bid, draft: !!blocks.draft, plans: !!blocks.plans, brief: true };
  const foldFor = (m: MoveId | null) => {
    const f = m ? OPEN_FOR[m] : undefined;
    return f && shown[f] ? f : undefined;
  };
  const first: Fold = foldFor(kit.next) || (blocks.draftInBid || blocks.bid ? "bid" : blocks.draft ? "draft" : "brief");
  const [open, setOpen] = useState<Record<Fold, boolean>>(() => ({ brief: first === "brief", plans: first === "plans", bid: first === "bid", draft: first === "draft" }));
  const [touched, setTouched] = useState(false);
  const set = (f: Fold) => (v: boolean) => setOpen((o) => (o[f] === v ? o : { ...o, [f]: v }));
  // The next move settles once the plans and the files are read: its panel opens then, and
  // until the operator folds a panel by hand it is the only one open.
  const [openedFor, setOpenedFor] = useState(kit.next);
  if (openedFor !== kit.next) {
    setOpenedFor(kit.next);
    const f = foldFor(kit.next);
    if (f) setOpen((o) => (touched ? { ...o, [f]: true } : { brief: false, plans: false, bid: false, draft: false, [f]: true }));
  }
  // A panel's toggle event also fires for the open state set here: only a change against what
  // this render set is the operator's.
  const byHand = (f: Fold) => (v: boolean) => {
    if (open[f] === v) return;
    setTouched(true);
    set(f)(v);
  };
  const onGo = (s: ReportSection) => {
    if (s === "brief" || s === "plans" || s === "bid" || s === "draft") set(s)(true);
    props.onGo(s);
  };
  const plansState = kit.view.accepted ? t("report.choose.acceptedLine", { seat: planSeatLabel(kit.view.accepted) }) : kit.view.ready ? t("plans.readyTip", { count: kit.view.ready }) : undefined;

  return (
    <div className="sm-grid">
      <DecisionSidebar gig={gig} kit={kit} proposalFile={proposalFile} now={now} attempts={attempts} onFlash={onFlash} onGo={onGo} />
      <article className="rp sm-read" aria-label={t(view === "brief" ? "brief.title" : "report.label")}>
        {view === "brief" ? (
          <div className="sm-sheet">{brief ? <BriefText brief={brief} withdraw={withdraw} /> : <NoBrief />}</div>
        ) : (
          <>
            <SummaryHead gig={gig} brief={brief} summary={summary} kpDraft={kit.kpDraft} now={now} onOpenListing={props.onOpenListing} />
            <div className="sm-folds">
              {blocks.bid ? (
                <Panel id="bid" title={t("proposal.bid.title")} state={blocks.draftInBid ? t("summary.bidOwn") : undefined} open={open.bid} onOpen={byHand("bid")}>
                  <p className="rp-lede">{blocks.draftInBid ? t("proposal.bid.ledeOwn") : t("proposal.bid.lede")}</p>
                  <BidBlock gig={gig} attempt={attempt} draft={blocks.draftInBid ? draft : null} onFlash={onFlash} />
                </Panel>
              ) : null}
              {blocks.draft ? (
                <Panel id="draft" title={t("report.sec.draft")} open={open.draft} onOpen={byHand("draft")}>
                  {draft}
                </Panel>
              ) : null}
              {blocks.plans ? (
                <Panel id="plans" title={blocks.plans === "accepted" ? t("report.sec.accepted") : t("report.sec.plans")} state={plansState} open={open.plans} onOpen={byHand("plans")}>
                  <PlanSeats gig={gig} kit={kit} />
                </Panel>
              ) : null}
              <Panel id="brief" title={t("summary.secBrief")} state={brief?.category} open={open.brief} onOpen={byHand("brief")}>
                {brief ? <BriefText brief={brief} withdraw={withdraw} title={false} /> : <NoBrief />}
              </Panel>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
