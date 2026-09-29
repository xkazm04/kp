"use client";

import { useMemo, type ReactNode } from "react";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import type { ReviewNote } from "../logic/reviewNote";
import { isLegacyRouted } from "../logic/pairing";
import { acceptedPlanOf } from "../logic/plans";
import type { SummaryText } from "../logic/summary";
import type { AfterWrite, SourceRow, SpecialistRow } from "../logic/wire";
import { EvidencePanel } from "./panels/EvidencePanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ListingPanel } from "./panels/ListingPanel";
import { PairingPanel } from "./panels/PairingPanel";
import { PlansPanel } from "./panels/PlansPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { RoutingPanel } from "./panels/RoutingPanel";
import type { GigRecord } from "./panels/useGigRecord";
import type { PlansState } from "./panels/usePlans";
import type { ProofTab } from "./proofTabs";
import { ProofSummary } from "./ProofSummary";

// The proof's chosen tab (GigsProof.tsx): one panel per tab id (proofTabs.tsx). The draft
// and the brief arrive built, since they read the proof's own desk and decline state. The
// `routing` tab is Pairing: the gig's own agent (PairingPanel), or the legacy routing view
// for a gig a niche specialist already worked (RoutingPanel).

export function ProofPanels({
  tab,
  gig,
  attempt,
  source,
  summary,
  now,
  note,
  record,
  recordError,
  specialists,
  persona,
  kpi,
  plansState,
  draft,
  brief,
  onChanged,
  onFlash,
  onOpenPlans,
  onOpenLane,
}: {
  tab: ProofTab;
  gig: Gig;
  attempt: GigAttempt | null;
  source: SourceRow | null;
  summary: SummaryText;
  now: Date;
  note: ReviewNote | null;
  record: GigRecord | null;
  recordError: string | null;
  specialists: readonly SpecialistRow[];
  persona: SpecialistRow | null;
  kpi: GigKpi | null;
  plansState: PlansState;
  draft: ReactNode;
  brief: ReactNode;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenPlans: () => void;
  onOpenLane: () => void;
}) {
  const accepted = useMemo(() => acceptedPlanOf(plansState.plans), [plansState.plans]);
  if (tab === "summary") return <ProofSummary gig={gig} summary={summary} source={source} now={now} />;
  if (tab === "plans") return <PlansPanel gig={gig} plansState={plansState} onFlash={onFlash} />;
  if (tab === "draft") return draft;
  if (tab === "evidence") return <EvidencePanel attempt={attempt} />;
  if (tab === "review") return <ReviewPanel note={note} />;
  if (tab === "history") return <HistoryPanel record={record} error={recordError} specialists={specialists} />;
  if (tab === "brief") return brief;
  if (tab === "listing") return <ListingPanel gig={gig} source={source} />;
  return isLegacyRouted(persona, attempt) ? (
    <RoutingPanel gig={gig} source={source} specialists={specialists} kpi={kpi} onChanged={onChanged} onOpenLane={onOpenLane} />
  ) : (
    <PairingPanel gig={gig} source={source} persona={persona} accepted={accepted} onChanged={onChanged} onOpenPlans={onOpenPlans} />
  );
}
