"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Mark, Segmented, type Segment } from "@/app/_components/kit";
import { KitTipLayer } from "@/app/_components/kit/KitTipLayer";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import type { ReviewNote } from "../logic/reviewNote";
import type { Doubt } from "../shared/doubts";

// The proof's sections as one tab row in the trail, beside the way back and the ← / → keys
// (the owner's review: the lettered back matter at the end left the machinery a long scroll
// away, and a row under the summary still pushed it down). Every tab is always shown; one
// with nothing in it for this gig's state is disabled, never hidden, so the row keeps its
// shape from gig to gig. Each section is a white panel composed from the kit, inside one
// `.k-kit` root so the kit's tokens and its delegated tip apply.
//   Summary           ProofSummary.tsx: the summary set for reading, the key facts beside it
//   Draft             the proof slip and the galley (DraftTab.tsx)
//   Evidence          what the agent ran: passed, failed, NOT VERIFIED (never two states)
//   Pre-send review   the reviewer's note set out: verdict, must-dos, defects, the checks it ran
//   Earlier drafts    every attempt, newest first: status, cost, the note that sent it back, verdicts
//   Research brief    panels/BriefPanel.tsx (always open: it holds Research again)
//   Listing           a stranger's text, framed as untrusted, invisible characters shown
//   Routing & folder  who it goes to and why, the fit, the folder, every candidate

export const PROOF_TABS = ["summary", "draft", "evidence", "review", "history", "brief", "listing", "routing"] as const;
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

/** The tab a proof opens on: its summary when there is one to read; else the draft for a gig
 *  with an attempt (or a quarantined one, whose listing IS the thing to judge); else the
 *  summary's facts and the listing's opening. */
export function defaultProofTab(gig: Gig, attempt: GigAttempt | null, hasSummary: boolean): ProofTab {
  if (hasSummary) return "summary";
  return attempt || gig.status === "suspect" ? "draft" : "summary";
}

/** The row: a count where one means something, a mark where something needs a look, and
 *  disabled where the gig's state leaves the section empty. */
export function useProofTabs({
  gig,
  attempt,
  doubts,
  note,
  attempts,
  recurring,
}: {
  gig: Gig | null;
  attempt: GigAttempt | null;
  doubts: readonly Doubt[];
  note: ReviewNote | null;
  /** How many attempts the fresh record holds; null while it loads. */
  attempts: number | null;
  /** Brief challenges the operator withdrew other gigs for before. */
  recurring: number;
}): Segment[] {
  const t = useTranslations("gigs");
  if (!gig) return [];
  const dl = attempt?.deliverable ?? null;
  const evidence = dl?.evidence.length ?? 0;
  const failedEvidence = dl ? dl.evidence.filter((e) => e.passed === false).length : 0;
  const stops = doubts.filter((x) => x.sev === "stop").length;
  return [
    { value: "summary", label: t("proof.summaryLabel") },
    {
      value: "draft",
      label: t("tabs.draft"),
      disabled: !attempt && gig.status !== "suspect",
      mark: stops ? <Mark kind="fail" tip={t("slip.stops", { count: stops })} /> : undefined,
    },
    {
      value: "evidence",
      label: t("back.evidence"),
      count: evidence || undefined,
      disabled: evidence === 0,
      mark: failedEvidence ? <Mark kind="fail" tip={t("back.failedN", { count: failedEvidence })} /> : undefined,
    },
    {
      value: "review",
      label: t("tabs.short.review"),
      disabled: !note,
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
    { value: "routing", label: t("tabs.short.routing") },
  ];
}
