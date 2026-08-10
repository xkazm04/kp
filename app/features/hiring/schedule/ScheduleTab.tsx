"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Defer } from "@/app/_components/ui/Defer";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { ScheduleEmptyRelay } from "./ScheduleEmptyRelay";
import { useScheduleTab } from "./useScheduleTab";
import { ScheduleTabPendingList } from "./ScheduleTabPendingList";
import { ScheduleTabInterviewedList } from "./ScheduleTabInterviewedList";
import type { SchedEntry } from "./ScheduleTypes";
import type { EvalTarget } from "./ScheduleAiRound";

// PROTOTYPE — the AI round subtab (link-out AI-first interviews as a
// ledger/docket). Lazy like the calendar: it only loads when the recruiter
// switches rounds.
const ScheduleAiRound = dynamic(() => import("./ScheduleAiRound").then((m) => ({ default: m.ScheduleAiRound })), {
  loading: () => <div className="reveal-quiet min-h-[16rem]" aria-hidden />,
});

// Tier 3 (docs/design/loading-choreography.md): the calendar grid is the heaviest piece
// of this tab's primary content (framer-motion layout animation + the week
// pager), and the two modals only ever mount once the recruiter clicks into
// prep or a transcript — neither belongs in the tab's entry chunk. The invite
// agenda is a secondary panel with its own independent fetch, deferred a frame
// so the primary calendar/list content is what the entry chunk carries.
const ScheduleCalendar = dynamic(() => import("./ScheduleCalendar").then((m) => ({ default: m.ScheduleCalendar })), {
  loading: () => <div className="reveal-quiet min-h-[26rem]" aria-hidden />,
});
const InviteLifecyclePanel = dynamic(
  () => import("./ScheduleInviteLifecyclePanel").then((m) => ({ default: m.InviteLifecyclePanel })),
  { loading: () => <div className="reveal-quiet min-h-[4rem]" aria-hidden /> }
);
const InterviewPrepModal = dynamic(() => import("./ScheduleInterviewPrepModal").then((m) => ({ default: m.InterviewPrepModal })));
const InterviewTranscriptModal = dynamic(() =>
  import("./ScheduleInterviewTranscriptModal").then((m) => ({ default: m.InterviewTranscriptModal }))
);

export function ScheduleTab() {
  const {
    t,
    entries,
    error,
    picks,
    selectedId,
    setSelectedId,
    busy,
    prepEntry,
    setPrepEntry,
    prepared,
    interviews,
    creatingIv,
    transcriptEntry,
    setTranscriptEntry,
    lastDir,
    reduced,
    load,
    calendarEntries,
    bookedMarkers,
    interviewedEntries,
    startInterview,
    act,
    cardExit,
    slotLabel,
  } = useScheduleTab();

  // PROTOTYPE — which interview round the tab shows. "human" keeps today's
  // calendar surface byte-identical; "ai" is the new link-out AI-first round.
  const [round, setRound] = useState<"human" | "ai">("human");

  // The AI ledger reviews HISTORY: a session keeps its entry id after the
  // pipeline entry advances, so the evaluation modals get a minimal entry
  // shape synthesized from the session row (the modals read id + labels only).
  const openEvaluation = (target: EvalTarget) =>
    setTranscriptEntry(
      (entries ?? []).find((e) => e.id === target.id) ??
        ({ id: target.id, candidateLabel: target.candidateLabel, jobTitle: target.jobTitle } as SchedEntry)
    );

  return (
    // Tier 1 (docs/design/loading-choreography.md): header, and the tab's real sections
    // as direct children of the stagger cascade. aria-busy covers the first
    // load only — the error/empty/content swap below never re-triggers it.
    <div data-sim="schedule" className="stagger-children space-y-6" aria-busy={entries == null && !error}>
      <header>
        <p className="text-meta uppercase text-coral">{t("eyebrow")}</p>
        <h2 className="mt-1 font-serif text-display text-ink">{t("title")}</h2>
        <p className="mt-1 max-w-2xl text-body text-steel">{t("intro")}</p>
      </header>

      {/* Round switcher: the calendar surface below is the HUMAN round; the AI
          round is the link-out docket. */}
      <SegmentedControl
        label={t("rounds.label")}
        options={[
          { value: "human", label: t("rounds.human") },
          { value: "ai", label: t("rounds.ai") },
        ]}
        value={round}
        onChange={setRound}
      />

      {round === "ai" ? (
        <ScheduleAiRound calendarEntries={calendarEntries} interviews={interviews} onOpenTranscript={openEvaluation} />
      ) : (
        <>
      {/* W6-3 — confirmed bookings, stalled invites and confirm/advance drift:
          the lifecycle the store tracked but no surface ever showed. Deferred a
          frame (tier 3) and code-split: it fetches independently and is
          secondary to the calendar/list below. */}
      <Defer strategy="next-frame">
        <InviteLifecyclePanel />
      </Defer>

      {/* This wrapper is the stable tier-1 slot; the swap inside it (tier 2) is
          what actually reacts to the fetch, so the arriving content fades in
          place instead of re-triggering the stagger's mount animation. */}
      <div>
        {error ? (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-base text-red-700">
            {error}
          </p>
        ) : entries == null ? (
          // Fetch in flight, nothing to show yet: hold the calendar/list grid's
          // height and stay invisible for 150ms so a fast response never flashes.
          <div className="reveal-quiet min-h-[26rem]" aria-hidden />
        ) : calendarEntries.length === 0 && interviewedEntries.length === 0 ? (
          // Schedule is a station, not a container: the empty state draws the
          // Decisions → Schedule → Interview relay so the baton waiting upstream is
          // visible, instead of dead-ending on "nothing to schedule".
          <ScheduleEmptyRelay />
        ) : (
        <div className="animate-arrive-in grid gap-5 lg:grid-cols-[1fr_300px]">
          <ScheduleCalendar
            entries={calendarEntries}
            picks={picks}
            bookedMarkers={bookedMarkers}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />

          <aside className="space-y-2">
            <ScheduleTabPendingList
              t={t}
              calendarEntries={calendarEntries}
              picks={picks}
              slotLabel={slotLabel}
              selectedId={selectedId}
              onSelect={setSelectedId}
              interviews={interviews}
              prepared={prepared}
              busy={busy}
              creatingIv={creatingIv}
              lastDir={lastDir}
              reduced={reduced}
              cardExit={cardExit}
              onPrep={setPrepEntry}
              onTranscript={setTranscriptEntry}
              onStartInterview={startInterview}
              onAct={act}
            />

            <ScheduleTabInterviewedList
              t={t}
              interviewedEntries={interviewedEntries}
              interviews={interviews}
              prepared={prepared}
              onPrep={setPrepEntry}
              onTranscript={setTranscriptEntry}
            />
          </aside>
        </div>
        )}
      </div>
        </>
      )}

      {prepEntry ? (
        <InterviewPrepModal
          entry={prepEntry}
          onClose={() => {
            setPrepEntry(null);
            // A verdict saved inside the modal may have gated the entry to
            // scorecard_review (DEC1) — reload so the card moves to "Interviewed"
            // instead of lingering in the calendar list with stale actions.
            load();
          }}
        />
      ) : null}
      {transcriptEntry ? <InterviewTranscriptModal entry={transcriptEntry} onClose={() => setTranscriptEntry(null)} /> : null}
    </div>
  );
}
