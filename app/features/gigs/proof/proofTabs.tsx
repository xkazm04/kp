"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Mark, Segmented, type Segment } from "@/app/_components/kit";
import { KitTipLayer } from "@/app/_components/kit/KitTipLayer";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import { clientMessageOf, pairingOpen } from "../logic/proposal";
import type { ReviewNote } from "../logic/reviewNote";
import type { Doubt } from "../shared/doubts";

// The proof's sections as one tab row in the trail, beside the way back and the ← / → keys.
// Every tab is always shown, a hairline between them; one with nothing in it for this gig's
// state is disabled AND greyed (styles/report.css), never hidden, so the row keeps its shape
// from gig to gig. Each section is a panel composed from the kit, inside one `.k-kit` root so
// the kit's tokens and its delegated tip apply.
//   Summary           the gig at a glance (summary/GigSummary.tsx): a compact header, the
//                     bid, the draft, the plans and the brief as folding panels, beside the
//                     decision sidebar (every move, the metadata)
//   Review            the pre-send review beside the message to the client (freelance)
//   History           every attempt, newest first: status, cost, the note that sent it back, verdicts
//   Brief             the brief on a sheet, beside the same decision sidebar (always open)
//   Listing           a stranger's text, framed as untrusted, invisible characters shown;
//                     the English translation above it when the listing is not in English
//   Pairing           the gig's own agent, its knowledge, the folder, the milestone
//                     (panels/PairingPanel.tsx; the legacy routing view for a gig a niche
//                     specialist already worked). The id stays `routing`. Disabled for a
//                     freelance bid no persona worked: it gets a proposal, not an agent.

export const PROOF_TABS = ["summary", "review", "history", "brief", "listing", "routing"] as const;
export type ProofTab = (typeof PROOF_TABS)[number];

/** The kit root: tokens, the calm density, the one delegated tip. */
export function KitArea({ className = "", children }: { className?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={root} className={`k-kit proof-kit ${className}`.trim()} data-density="calm">
      {children}
      <KitTipLayer root={root} />
    </div>
  );
}

export function ProofTabRow({ tabs, value, onChange }: { tabs: Segment[]; value: ProofTab; onChange: (tab: ProofTab) => void }) {
  const t = useTranslations("gigs");
  return (
    <KitArea className="proof-tabs">
      <Segmented items={tabs} value={value} onChange={(v) => onChange(v as ProofTab)} label={t("tabs.label")} />
    </KitArea>
  );
}

/** The row: a count where one means something, a mark where something needs a look, and
 *  disabled where the gig's state leaves the section empty. */
export function useProofTabs({
  gig,
  attempt,
  persona,
  doubts,
  note,
  attempts,
  recurring,
  plans,
}: {
  gig: Gig | null;
  attempt: GigAttempt | null;
  /** The gig has its own persona (the Pairing tab stays open for it on either track). */
  persona: boolean;
  doubts: readonly Doubt[];
  note: ReviewNote | null;
  /** How many attempts the fresh record holds; null while it loads. */
  attempts: number | null;
  /** Brief challenges the operator withdrew other gigs for before. */
  recurring: number;
  /** Plans ready in the shown round, and whether one is accepted. */
  plans: { ready: number; accepted: boolean };
}): Segment[] {
  const t = useTranslations("gigs");
  if (!gig) return [];
  const dl = attempt?.deliverable ?? null;
  const failedEvidence = dl ? dl.evidence.filter((e) => e.passed === false).length : 0;
  const stops = doubts.filter((x) => x.sev === "stop").length;
  const outreach = clientMessageOf(gig) !== null;
  const pairs = pairingOpen(gig, persona, attempt);
  // The report's one mark: what stops Approve first, then a failed check, then a plan to accept.
  const summaryMark = stops ? (
    <Mark kind="fail" tip={t("slip.stops", { count: stops })} />
  ) : failedEvidence ? (
    <Mark kind="fail" tip={t("back.failedN", { count: failedEvidence })} />
  ) : plans.ready && !plans.accepted ? (
    <Mark kind="caution" tip={t("plans.readyTip", { count: plans.ready })} />
  ) : undefined;
  return [
    { value: "summary", label: t("proof.summaryLabel"), mark: summaryMark },
    {
      value: "review",
      label: t("tabs.short.review"),
      disabled: !note && !outreach,
      mark:
        note?.verdict === "blocker" ? (
          <Mark kind="fail" tip={t("slip.reviewBlockers", { count: note.blockers })} />
        ) : note?.verdict === "warnings" ? (
          <Mark kind="caution" tip={t("back.warningsYouDecide")} />
        ) : undefined,
    },
    { value: "history", label: t("tabs.short.history"), count: attempts || undefined, disabled: !attempt && !attempts },
    { value: "brief", label: t("tabs.short.brief"), mark: recurring ? <Mark kind="caution" tip={t("brief.recurringTip", { count: recurring })} /> : undefined },
    {
      value: "listing",
      label: t("tabs.short.listing"),
      disabled: !gig.bodyText.trim(),
      mark: gig.suspectReasons.length ? <Mark kind="caution" tip={t("back.flags", { count: gig.suspectReasons.length })} /> : undefined,
    },
    { value: "routing", label: t("pairing.tab"), disabled: !pairs, tip: pairs ? undefined : t("proposal.pairingOff") },
  ];
}
