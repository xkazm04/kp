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
import { revealSoon } from "./report/parts";
import type { GigFileState } from "./report/useGigFile";
import { GigSummary } from "./summary/GigSummary";

// The proof's chosen tab (GigsProof.tsx): one panel per tab id (proofTabs.tsx). The Summary and
// the Brief tabs are ONE component (summary/GigSummary.tsx) that carries the decision sidebar on
// both; the draft arrives built, since it reads the proof's own desk. The `routing` tab is
// Pairing: the gig's own agent (PairingPanel), or the legacy routing view for a gig a niche
// specialist already worked (RoutingPanel).

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
  onChanged,
  onFlash,
  onOpenPlans,
  onOpenLane,
  onOpenTab,
  now,
  attempts,
  withdraw,
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
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenPlans: () => void;
  onOpenLane: () => void;
  onOpenTab: (tab: ProofTab) => void;
  now: Date;
  attempts: readonly GigAttempt[];
  withdraw: ChallengeWithdraw;
}) {
  const accepted = useMemo(() => acceptedPlanOf(plansState.plans), [plansState.plans]);
  if (tab === "summary" || tab === "brief") {
    const onGo = (s: ReportSection) => {
      onOpenTab("summary");
      revealSoon(reportAnchor(s));
    };
    return <GigSummary {...{ view: tab, gig, attempt, summary, plansState, proposalFile, draft, now, attempts, withdraw, onChanged, onFlash, onGo }} onOpenListing={() => onOpenTab("listing")} />;
  }
  if (tab === "review") return <ReviewPanel gig={gig} note={note} onChanged={onChanged} />;
  if (tab === "history") return <HistoryPanel record={record} error={recordError} specialists={specialists} />;
  if (tab === "listing") return <ListingPanel gig={gig} source={source} />;
  return isLegacyRouted(persona, attempt) ? (
    <RoutingPanel gig={gig} source={source} specialists={specialists} kpi={kpi} onChanged={onChanged} onOpenLane={onOpenLane} />
  ) : (
    <PairingPanel gig={gig} source={source} persona={persona} accepted={accepted} onChanged={onChanged} onOpenPlans={onOpenPlans} />
  );
}
