"use client";

import { CalendarClock } from "lucide-react";
// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the today /
// upcoming / awaiting split lives in a pure, unit-tested module so a confirmed
// interview no longer vanishes the instant its start passes.
import { bucketInvites, isInProgress } from "./scheduleInviteLifecycleBuckets";
import { useScheduleInviteLifecycle } from "./useScheduleInviteLifecycle";
import { AttentionSection } from "./ScheduleInviteAttentionSection";
import { AgendaRow } from "./ScheduleInviteAgendaRow";
import { AwaitingSection, ClosedSection } from "./ScheduleInviteHistorySection";

// W6-3 (SCH1) — the invite lifecycle, finally visible. Once a self-scheduling
// link was minted its whole life was invisible: no agenda of confirmed
// bookings, no view of sent-but-never-booked invites, and the operator flags
// the store deliberately persists "for the recruiter" — needs_more_slots
// (candidate hit a fully-booked horizon) and needs_reconcile (booked but the
// pipeline didn't advance) — terminated in a server console. Attention rows
// first; then the chronological agenda; then invites still awaiting a booking.
export function InviteLifecyclePanel() {
  const {
    t,
    relativeTime,
    relayConfigured,
    slotLabel,
    slotLine,
    base,
    invites,
    loadedAt,
    failed,
    armed,
    setArmed,
    busy,
    runAction,
    reinvite,
    updateInvite,
  } = useScheduleInviteLifecycle();

  if (failed) {
    return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  if (invites === null) {
    // Fetch in flight, nothing to show yet: hold this panel's rough height and
    // stay invisible for 150ms so a fast response never flashes a placeholder
    // (docs/design/loading-choreography.md, tier 2 — no skeletons, no pulse).
    return <div className="reveal-quiet min-h-[4rem]" aria-hidden />;
  }
  if (invites.length === 0) return null;

  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — pure bucketing:
  // adds a "today / in-progress / recent" bucket so a confirmed interview stays on
  // the panel through its start time and immediate aftermath instead of disappearing.
  const { attention, upcoming, today, awaiting, closed } = bucketInvites(invites, loadedAt);

  if (
    attention.length === 0 &&
    upcoming.length === 0 &&
    today.length === 0 &&
    awaiting.length === 0 &&
    closed.length === 0
  )
    return null;

  const rowProps = {
    t,
    slotLine,
    relayConfigured,
    base,
    armed,
    setArmed,
    busy,
    runAction,
    onSavedMeetingUrl: (token: string, url: string | null) => updateInvite(token, { meetingUrl: url }),
  };

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <CalendarClock size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>

      <AttentionSection attention={attention} t={t} slotLabel={slotLabel} armed={armed} setArmed={setArmed} busy={busy} runAction={runAction} />

      {/* bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the in-
          progress / just-finished bucket that used to vanish; shown first as the
          most time-sensitive (a call happening now, or one needing a no-show call). */}
      {today.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("today", { count: today.length })}</p>
          <ul className="mt-1.5 space-y-1">
            {today.map((i) => (
              <AgendaRow key={i.id} invite={i} inProgress={isInProgress(i.slotAt, i.durationMin, loadedAt)} {...rowProps} />
            ))}
          </ul>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("upcoming", { count: upcoming.length })}</p>
          <ul className="mt-1.5 space-y-1">
            {upcoming.map((i) => (
              <AgendaRow key={i.id} invite={i} {...rowProps} />
            ))}
          </ul>
        </div>
      ) : null}

      <AwaitingSection awaiting={awaiting} t={t} relayConfigured={relayConfigured} relativeTime={relativeTime} />

      <ClosedSection closed={closed} loadedAt={loadedAt} t={t} slotLine={slotLine} armed={armed} setArmed={setArmed} busy={busy} reinvite={reinvite} />
    </section>
  );
}
