"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { gigTypeOf } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigAttempt, GigKpi } from "@/app/_lib/gigs/types";
import { listNeighbours } from "../logic/front";
import { nicheKeyOf, type Niche } from "../logic/niches";
import { gigPersonaOf } from "../logic/pairing";
import { planView } from "../logic/plans";
import { reportAnchor } from "../logic/report";
import { summaryTextOf } from "../logic/summary";
import type { AfterWrite, SourceRow, SpecialistRow } from "../logic/wire";
import { useDoubts } from "../shared/doubts";
import { DraftTab, useDeskMemory, usePinned, useSlipJump } from "./DraftTab";
import { useChallengeMemory } from "./panels/BriefChallenges";
import { GigBriefPanel } from "./panels/BriefPanel";
import { useGigRecord } from "./panels/useGigRecord";
import { usePlans } from "./panels/usePlans";
import { KitArea, ProofTabRow, useProofTabs, type ProofTab } from "./proofTabs";
import { ProofHead, ProofNotFound } from "./ProofHead";
import { ProofPanels } from "./ProofPanels";
import { ProofTrail } from "./ProofTrail";
import { revealSoon } from "./report/parts";
import { GigsSignoff, type DeskStore } from "./signoff/GigsSignoff";
import { DeclineConfirm, useProofDecline } from "./useProofDecline";

// One gig as a full page (B/3 "The Proof", the owner's pick "for well formatted content and
// designed sections"). It REPLACES the section it was opened from; the trail on top
// (ProofTrail.tsx) carries the way back (the crumb, ×, Esc), the section tabs
// (proofTabs.tsx), and the list it was opened from, walked with ← / → (the owner's keys; no
// wrap) - and Decline (D), confirmed by D again or Enter (useProofDecline.tsx).
//
// Left: the sign-off (signoff/) - the state and only the moves it allows. Right: the chosen
// tab's panel (ProofPanels.tsx) - the gig's report on Summary, which opens with its own
// title, else the head and the panel. The plans are read here (usePlans.ts) and shared: the
// report's plans section, the tab row's mark, and the dispatch gate in the sign-off.
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
  onOpenLane: (lane: string | null) => void;
}) {
  const t = useTranslations("gigs");
  const doubtsOf = useDoubts();
  const backRef = useRef<HTMLButtonElement | null>(null);

  const gig = gigs.find((g) => g.id === gigId) ?? null;
  const attempt = gig ? (attemptsByGig[gig.id] ?? null) : null;
  const source = gig?.sourceId ? (sources.find((s) => s.id === gig.sourceId) ?? null) : null;
  // The gig's own persona (pairing); a gig nobody worked yet has no specialist before it.
  const persona = gig ? gigPersonaOf(gig, specialists) : null;
  const specialistId = attempt?.specialistId ?? persona?.id ?? null;
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
  const [tab, setTab] = useState<ProofTab>("summary");
  const { record, error: recordError } = useGigRecord(gig);
  const plansState = usePlans(gig?.id ?? null);
  const plans = useMemo(() => planView(plansState.plans), [plansState.plans]);
  const tabs = useProofTabs({ gig, attempt, doubts, note, attempts: record ? record.attempts.length : null, recurring, plans: { ready: plans.ready, accepted: plans.accepted !== null } });
  const showReport = useCallback(() => setTab("summary"), []);
  const jump = useSlipJump(showReport);
  const openPlans = useCallback(() => {
    setTab("summary");
    revealSoon(reportAnchor("plans"));
  }, []);

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

  const withdraw = { onWithdraw: decline.canWithdraw ? (i: number) => void decline.withdrawFor(i, challenges[i] ?? "") : null, busy: decline.withdrawing, counts: withdrawCounts, reason: gig.withdrawReason };
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
          planGate={plansState.plans === null && !plansState.failure ? "loading" : plans.accepted || plansState.failure ? "ok" : "missing"}
          onOpenPlans={openPlans}
        />
        <div className="col">
          {tab === "summary" ? null : <ProofHead gig={gig} nicheLabel={niche?.label ?? null} />}

          <KitArea>
            <div className="proof-panel" key={tab}>
              <ProofPanels
                {...{ tab, gig, attempt, source, summary, now, note, record, recordError, specialists, persona, kpi, plansState, onChanged, onFlash }}
                draft={<DraftTab gig={gig} attempt={attempt} source={source} specialistName={specialist?.name ?? null} now={now} doubts={doubts} note={note} pinned={pinned} memory={memory} setMemory={setMemory} onJump={jump} />}
                brief={<GigBriefPanel gig={gig} onChanged={onChanged} withdraw={withdraw} />}
                onOpenPlans={openPlans}
                onOpenTab={setTab}
                onOpenLane={() => onOpenLane(gigTypeOf(gig))}
              />
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
