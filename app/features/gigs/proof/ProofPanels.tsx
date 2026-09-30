"use client";

import { useMemo, type ReactNode } from "react";
import type { Gig, GigAttempt, GigKpi, GigProposal } from "@/app/_lib/gigs/types";
import { reportAnchor, type ReportSection } from "../logic/report";
import type { ReviewNote } from "../logic/reviewNote";
import { isLegacyRouted } from "../logic/pairing";
import { acceptedPlanOf } from "../logic/plans";
import type { SummaryText } from "../logic/summary";
import type { AfterWrite, SourceRow, SpecialistRow } from "../logic/wire";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ListingPanel } from "./panels/ListingPanel";
import { PairingPanel } from "./panels/PairingPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { RoutingPanel } from "./panels/RoutingPanel";
import type { GigRecord } from "./panels/useGigRecord";
import type { PlansState } from "./panels/usePlans";
import type { ProofTab } from "./proofTabs";
import type { ChallengeWithdraw } from "./panels/BriefChallenges";
import { GigReport } from "./report/GigReport";
import { revealSoon } from "./report/parts";
import { SummaryDossier } from "./report/variants/SummaryDossier";
import { SummarySwitch, type SummaryVariant } from "./report/variants/SummarySwitch";
import { SummaryWorkbench } from "./report/variants/SummaryWorkbench";
import type { GigFileState } from "./report/useGigFile";

// The proof's chosen tab (GigsProof.tsx): one panel per tab id (proofTabs.tsx); Summary is
// the gig's overview (report/GigReport.tsx), which carries the brief panel too. The draft
// and the brief arrive built, since they read the proof's own desk and decline state. The
// `routing` tab is Pairing: the gig's own agent (PairingPanel), or the legacy routing view
// for a gig a niche specialist already worked (RoutingPanel). While the WP13 prototype runs
// (dev only, report/variants/SummarySwitch.tsx) the Summary AND Brief tabs render the chosen
// variant, which carries the one decision sidebar on both.

export function ProofPanels({
  tab,
  gig,
  attempt,
  source,
  summary,
  note,
  record,
  recordError,
  specialists,
  persona,
  kpi,
  plansState,
  proposalFile,
  draft,
  brief,
  onChanged,
  onFlash,
  onOpenPlans,
  onOpenLane,
  onOpenTab,
  proto,
}: {
  tab: ProofTab;
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  summary: SummaryText;
  note: ReviewNote | null;
  record: GigRecord | null;
  recordError: string | null;
  specialists: readonly SpecialistRow[];
  persona: SpecialistRow | null;
  kpi: GigKpi | null;
  plansState: PlansState;
  proposalFile: GigFileState<GigProposal>;
  draft: ReactNode;
  brief: ReactNode;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenPlans: () => void;
  onOpenLane: () => void;
  onOpenTab: (tab: ProofTab) => void;
  /** The WP13 prototype: which Summary variant renders, the switch, and what they add. */
  proto: { variant: SummaryVariant; show: boolean; now: Date; attempts: readonly GigAttempt[]; withdraw: ChallengeWithdraw };
}) {
  const accepted = useMemo(() => acceptedPlanOf(plansState.plans), [plansState.plans]);
  const { variant, show, now, attempts, withdraw } = proto;
  if ((tab === "summary" || tab === "brief") && variant !== "baseline") {
    const onGo = (s: ReportSection) => {
      onOpenTab("summary");
      revealSoon(reportAnchor(s));
    };
    const Variant = variant === "dossier" ? SummaryDossier : SummaryWorkbench;
    const props = { view: tab, gig, attempt, summary, plansState, proposalFile, draft, now, attempts, withdraw, onChanged, onFlash, onGo, onOpenListing: () => onOpenTab("listing") } as const;
    return (
      <>
        {show ? <SummarySwitch value={variant} /> : null}
        <Variant {...props} />
      </>
    );
  }
  if (tab === "summary") {
    return (
      <>
        {show ? <SummarySwitch value={variant} /> : null}
        <GigReport {...{ gig, attempt, summary, plansState, proposalFile, brief, draft, onChanged, onFlash, onOpenTab }} />
      </>
    );
  }
  if (tab === "review") return <ReviewPanel gig={gig} note={note} onChanged={onChanged} />;
  if (tab === "history") return <HistoryPanel record={record} error={recordError} specialists={specialists} />;
  if (tab === "brief") return brief;
  if (tab === "listing") return <ListingPanel gig={gig} source={source} />;
  return isLegacyRouted(persona, attempt) ? (
    <RoutingPanel gig={gig} source={source} specialists={specialists} kpi={kpi} onChanged={onChanged} onOpenLane={onOpenLane} />
  ) : (
    <PairingPanel gig={gig} source={source} persona={persona} accepted={accepted} onChanged={onChanged} onOpenPlans={onOpenPlans} />
  );
}
