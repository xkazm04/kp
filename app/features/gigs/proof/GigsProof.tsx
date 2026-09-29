"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { Gig, GigArena, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { listNeighbours } from "../logic/front";
import { nicheKeyOf, type Niche } from "../logic/niches";
import { summaryTextOf } from "../logic/summary";
import type { AfterWrite, SourceRow, SpecialistRow } from "../logic/wire";
import { useDoubts } from "../shared/doubts";
import { DraftTab, useDeskMemory, usePinned, useSlipJump } from "./DraftTab";
import { EvidencePanel } from "./panels/EvidencePanel";
import { useChallengeMemory } from "./panels/BriefChallenges";
import { GigBriefPanel } from "./panels/BriefPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ListingPanel } from "./panels/ListingPanel";
import { ReviewPanel } from "./panels/ReviewPanel";
import { RoutingPanel } from "./panels/RoutingPanel";
import { useGigRecord } from "./panels/useGigRecord";
import { defaultProofTab, KitArea, ProofTabRow, useProofTabs, type ProofTab } from "./proofTabs";
import { ProofHead, ProofNotFound } from "./ProofHead";
import { ProofSummary } from "./ProofSummary";
import { ProofTrail } from "./ProofTrail";
import { GigsSignoff, type DeskStore } from "./signoff/GigsSignoff";
import { DeclineConfirm, useProofDecline } from "./useProofDecline";

// One gig as a full page (B/3 "The Proof", the owner's pick "for well formatted content and
// designed sections"). It REPLACES the section it was opened from; the trail on top
// (ProofTrail.tsx) carries the way back (the crumb, ×, Esc), the section tabs
// (proofTabs.tsx), and the list it was opened from, walked with ← / → (the owner's keys; no
// wrap) - and Decline (D), confirmed by D again or Enter (useProofDecline.tsx).
//
// Left: the sign-off (signoff/) - the state and only the moves it allows. Right: the head,
// then the chosen tab's panel: the summary (ProofSummary.tsx), the draft (DraftTab.tsx: the
// proof slip over the galley) or one of panels/.
//
// Every page swap lands at the top with focus on the way back, so focus never sits on a
// control that is gone.

export type ProofList = { ids: string[]; label: string };

export function GigsProof({
  gigId,
  list,
  gigs,
  attemptsByGig,
  sources,
  specialists,
  niches,
  kpi,
  now,
  store,
  onStep,
  onBack,
  onLeft,
  onChanged,
  onFlash,
  onOpenLane,
}: {
  gigId: string;
  list: ProofList;
  gigs: readonly Gig[];
  attemptsByGig: Readonly<Record<string, GigAttempt>>;
  sources: readonly SourceRow[];
  specialists: readonly SpecialistRow[];
  niches: readonly Niche[];
  kpi: GigKpi | null;
  now: Date;
  store: DeskStore;
  onStep: (gigId: string) => void;
  onBack: () => void;
  /** The gig left the list (declined): open `next` (or go back when null), and say `message`. */
  onLeft: (next: string | null, message: string) => void;
  onChanged: AfterWrite;
  onFlash: (message: string) => void;
  onOpenLane: (lane: string | null, arena: GigArena | null) => void;
}) {
  const t = useTranslations("gigs");
  const doubtsOf = useDoubts();
  const backRef = useRef<HTMLButtonElement | null>(null);

  const gig = gigs.find((g) => g.id === gigId) ?? null;
  const attempt = gig ? (attemptsByGig[gig.id] ?? null) : null;
  const source = gig?.sourceId ? (sources.find((s) => s.id === gig.sourceId) ?? null) : null;
  const specialistId = attempt?.specialistId ?? gig?.specialistId ?? null;
  const specialist = specialistId ? (specialists.find((s) => s.id === specialistId) ?? null) : null;
  const niche = specialist ? (niches.find((n) => n.key === nicheKeyOf(specialist)) ?? null) : null;
  const pos = listNeighbours(list.ids, gigId);
  const onDesk = attempt !== null && (attempt.status === "drafted" || attempt.status === "approved");

  const { memory, setMemory } = useDeskMemory(attempt, onDesk, store);
  const { doubts, findings, note } = useMemo(
    () => (gig ? doubtsOf(gig, attempt, source, now) : { doubts: [], findings: [], note: null }),
    [gig, attempt, source, now, doubtsOf]
  );
  const pinned = usePinned(onDesk ? (attempt?.deliverable?.draftText ?? "") : "", findings, note);
  const { challenges, counts: withdrawCounts, recurring } = useChallengeMemory(gigs, gig);
  const summary = gig ? summaryTextOf(onDesk ? attempt?.deliverable?.summary : null, gig.brief?.markdown, gig.bodyText) : null;

  // Arriving on a page: its top, focus on the way back.
  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [gigId]);

  const decline = useProofDecline({ gig, pos, onBack, onStep, onChanged, onLeft });
  const [tab, setTab] = useState<ProofTab>(() => (gig ? defaultProofTab(gig, attempt, summary?.kind !== "listing") : "summary"));
  const { record, error: recordError } = useGigRecord(gig);
  const tabs = useProofTabs({ gig, attempt, doubts, note, attempts: record ? record.attempts.length : null, recurring });
  const jump = useSlipJump(setTab);

  const trail = (withTabs: boolean) => (
    <ProofTrail
      label={list.label}
      pos={pos}
      backRef={backRef}
      onBack={onBack}
      onStep={onStep}
      tabs={withTabs ? <ProofTabRow tabs={tabs} value={tab} onChange={setTab} /> : null}
      canDecline={withTabs && decline.canDecline && !decline.confirming}
      onDecline={decline.askDecline}
      declineRef={decline.declineRef}
      declining={decline.declining}
    />
  );

  if (!gig || !summary) {
    return (
      <div>
        {trail(false)}
        <ProofNotFound />
      </div>
    );
  }

  const reviewNoteText = note && note.header ? [note.lead, ...note.items.map((x, i) => `${i + 1}) ${x}`), ...note.defects.map((x) => x.text)].filter(Boolean).join("\n") : null;

  return (
    <div className="enter">
      {trail(true)}
      {decline.confirming ? <DeclineConfirm title={gig.title} declining={decline.declining} confirmRef={decline.confirmRef} onConfirm={() => void decline.decline()} onCancel={decline.cancelConfirm} /> : null}
      {decline.declineError ? (
        <p role="alert" className="alert gap-below">
          {decline.declineError}
        </p>
      ) : null}

      <div className="proof">
        <GigsSignoff
          gig={gig}
          attempt={attempt}
          source={source}
          specialist={specialist}
          kpi={kpi}
          now={now}
          findings={findings}
          memory={memory}
          setMemory={setMemory}
          reviewNoteText={reviewNoteText}
          onChanged={onChanged}
          onFlash={onFlash}
          onDecline={decline.askDecline}
          onHire={() => onOpenLane(null, gig.arena)}
        />
        <div className="col">
          <ProofHead gig={gig} nicheLabel={niche?.label ?? null} />

          <KitArea>
            <div className="proof-panel" key={tab}>
              {tab === "summary" ? (
                <ProofSummary gig={gig} summary={summary} source={source} now={now} />
              ) : tab === "draft" ? (
                <DraftTab gig={gig} attempt={attempt} source={source} specialistName={specialist?.name ?? null} now={now} doubts={doubts} note={note} pinned={pinned} memory={memory} setMemory={setMemory} onJump={jump} />
              ) : tab === "evidence" ? (
                <EvidencePanel attempt={attempt} />
              ) : tab === "review" ? (
                <ReviewPanel note={note} />
              ) : tab === "history" ? (
                <HistoryPanel record={record} error={recordError} specialists={specialists} />
              ) : tab === "brief" ? (
                <GigBriefPanel
                  gig={gig}
                  onChanged={onChanged}
                  withdraw={{ onWithdraw: decline.canWithdraw ? (i) => void decline.withdrawFor(i, challenges[i] ?? "") : null, busy: decline.withdrawing, counts: withdrawCounts, reason: gig.withdrawReason }}
                />
              ) : tab === "listing" ? (
                <ListingPanel gig={gig} source={source} />
              ) : (
                <RoutingPanel gig={gig} source={source} specialists={specialists} kpi={kpi} onChanged={onChanged} onOpenLane={() => onOpenLane(niche?.key ?? null, null)} />
              )}
            </div>
          </KitArea>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {pos ? t("proof.position", { index: pos.index, total: pos.total, list: list.label }) : null}
      </span>
    </div>
  );
}
