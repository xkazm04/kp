"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { planSeatsFor } from "@/app/_lib/gigs/plan-seats";
import type { Gig, GigAttempt, GigProposal } from "@/app/_lib/gigs/types";
import { planView } from "../../../logic/plans";
import { nextMove, type MoveFacts } from "../../../logic/moves";
import { isKpDraft, proposalHasFile, trackOf } from "../../../logic/proposal";
import { summaryBlocks, type ReportSection } from "../../../logic/report";
import type { SummaryText } from "../../../logic/summary";
import type { AfterWrite } from "../../../logic/wire";
import type { ChallengeWithdraw } from "../../panels/BriefChallenges";
import { usePlanActions, type PlansState } from "../../panels/usePlans";
import { useResearch } from "../../panels/useResearch";
import { useGigFile, type GigFileState } from "../useGigFile";

// What both Summary prototypes read and act with, built ONCE per render and handed to the
// reading column and the decision sidebar alike: the research (its fresh brief shown in place),
// the report file, the plan actions (Generate / Propose again in Moves, Accept on each seat
// card: one busy flag and one error for both), which working blocks apply (logic/report.ts),
// and the gig's next move (logic/moves.ts) - the one primary button.

/** The props every Summary variant takes (ProofPanels.tsx): the baseline's, plus what the
 *  sidebar and the challenge rows need, and `view` - the Summary tab or the Brief tab. */
export type SummaryProps = {
  view: "summary" | "brief";
  gig: Gig;
  attempt: GigAttempt | null;
  summary: SummaryText;
  plansState: PlansState;
  proposalFile: GigFileState<GigProposal>;
  draft: ReactNode;
  now: Date;
  attempts: readonly GigAttempt[];
  withdraw: ChallengeWithdraw;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenListing: () => void;
  /** Show a Summary block (switching to the Summary tab first) and focus its heading. */
  onGo: (section: ReportSection) => void;
};

const CLOSED = new Set(["declined", "withdrawn", "expired", "suspect", "sent", "accepted", "rejected"]);

export function useSummaryKit({ gig, attempt, plansState, proposalFile, onChanged, onFlash }: SummaryProps) {
  const t = useTranslations("gigs");
  const research = useResearch(gig, onChanged);
  const report = useGigFile(gig, "report", onChanged, t("report.file.regenerateFailed"));
  const view = useMemo(() => planView(plansState.plans), [plansState.plans]);
  const lineup = planSeatsFor(research.brief?.difficulty).map((s) => s.label);
  const planAct = usePlanActions(gig.id, plansState, onFlash, lineup.length);
  const bidTrack = trackOf(gig) === "proposal";
  const kpDraft = isKpDraft(attempt);
  const draftText = !!attempt?.deliverable?.draftText?.trim();
  const blocks = summaryBlocks({
    brief: research.brief !== null,
    plans: plansState.plans === null ? null : (view.shown?.rows.length ?? 0),
    accepted: view.accepted !== null,
    draft: draftText,
    proposalTrack: bidTrack,
    proposal: !!gig.proposal?.message.trim(),
    kpDraft,
  });
  const facts: MoveFacts = {
    brief: research.brief !== null,
    plans: plansState.plans === null ? (plansState.failure ? 0 : null) : (view.shown?.rows.length ?? 0),
    plansBusy: view.busy || planAct.busy,
    accepted: view.accepted !== null,
    proposalTrack: bidTrack,
    proposalFile: proposalHasFile(proposalFile.file),
    proposalWriting: proposalFile.writing,
    draftOnDesk: draftText && (attempt?.status === "drafted" || attempt?.status === "approved"),
    kpDraft,
    report: report.file !== null,
    reportWriting: report.writing,
    closed: CLOSED.has(gig.status),
  };
  return { research, report, view, lineup, planAct, blocks, facts, next: nextMove(facts), bidTrack, kpDraft, plansState };
}

export type SummaryKit = ReturnType<typeof useSummaryKit>;
