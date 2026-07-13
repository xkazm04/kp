"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, Hourglass } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSlotLabel } from "@/app/_lib/use-slot-label";
import { publicBaseUrl } from "@/app/_lib/public-base-url";
import { interviewCalendarEvent } from "@/app/_lib/calendar-links";
import { useRelativeTime } from "@/app/features/sub_pipeline/PipelineShared";
import { useDeliveryCapability } from "@/app/features/useDeliveryCapability";
import { AddToCalendar } from "./AddToCalendar";
import { MeetingLinkCell } from "./MeetingLinkCell";
// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the today /
// upcoming / awaiting split lives in a pure, unit-tested module so a confirmed
// interview no longer vanishes the instant its start passes.
import { bucketInvites, isInProgress } from "./invite-lifecycle-buckets";
// The full invite wire row is single-sourced from the store (GET /api/schedule
// returns listScheduleInvites() unprojected). Type-only import, so schedule-store's
// better-sqlite3 runtime is NOT pulled into this client bundle. Replaces a lossy
// hand-copied 17-field mirror that already lagged the source.
import type { ScheduleInvite } from "@/app/_lib/schedule-store";

// W6-3 (SCH1) — the invite lifecycle, finally visible. Once a self-scheduling
// link was minted its whole life was invisible: no agenda of confirmed
// bookings, no view of sent-but-never-booked invites, and the operator flags
// the store deliberately persists "for the recruiter" — needs_more_slots
// (candidate hit a fully-booked horizon) and needs_reconcile (booked but the
// pipeline didn't advance) — terminated in a server console. Attention rows
// first; then the chronological agenda; then invites still awaiting a booking.
export function InviteLifecyclePanel() {
  const t = useTranslations("scheduleTab.lifecycle");
  const relativeTime = useRelativeTime();
  // REC-10 — with no delivery relay, "invite/reminder sent" chips must read as
  // the queued outbox rows they really are.
  const relayConfigured = useDeliveryCapability();
  // SCH4 — render the booked slot in the recruiter's active locale via the
  // canonical hook (the picker already uses it), instead of a raw locale-less
  // toLocaleString() that also rendered "Invalid Date" on an unparsable slotAt.
  const slotLabel = useSlotLabel();
  // App origin → a clickable reschedule link inside the calendar event body.
  const base = publicBaseUrl(typeof window !== "undefined" ? window.location.origin : "");
  const [invites, setInvites] = useState<ScheduleInvite[] | null>(null);
  // "Now" captured when the data landed, so the upcoming/past split is a pure
  // function of state during render (react-hooks/purity) — the agenda is as
  // fresh as the fetch, which is the honest claim anyway.
  const [loadedAt, setLoadedAt] = useState(0);
  const [failed, setFailed] = useState(false);
  // Patch one invite in place (e.g. after a meeting link save) so the row + its
  // calendar event refresh without a full refetch.
  const updateInvite = (token: string, patch: Partial<ScheduleInvite>) =>
    setInvites((prev) => prev?.map((i) => (i.token === token ? { ...i, ...patch } : i)) ?? prev);

  useEffect(() => {
    let alive = true;
    fetch("/api/schedule")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => {
        if (!alive) return;
        setInvites((p.invites as ScheduleInvite[]) ?? []);
        setLoadedAt(Date.now());
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{t("loadFailed")}</p>;
  }
  if (invites === null) {
    return <div role="status" aria-label={t("loading")} className="h-16 animate-pulse rounded-lg bg-stone-100" />;
  }
  if (invites.length === 0) return null;

  // bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — pure bucketing:
  // adds a "today / in-progress / recent" bucket so a confirmed interview stays on
  // the panel through its start time and immediate aftermath instead of disappearing.
  const { attention, upcoming, today, awaiting } = bucketInvites(invites, loadedAt);

  if (attention.length === 0 && upcoming.length === 0 && today.length === 0 && awaiting.length === 0) return null;

  const slotLine = (i: ScheduleInvite) =>
    i.slotAt
      ? `${slotLabel(i.slotAt, i.slot)}${i.durationMin ? ` · ${i.durationMin} min` : ""}`
      : (i.slot ?? "—");

  // One agenda row, shared by the "today" and "upcoming" lists so they can't drift.
  // `inProgress` adds a live chip on a call happening right now.
  const agendaRow = (i: ScheduleInvite, inProgress = false) => (
    <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
      <span className="font-semibold text-ink nums">{slotLine(i)}</span>
      <span className="text-ink">{i.candidateLabel ?? "—"}</span>
      {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
      {/* idea-b51106df — the candidate's own timezone, so the recruiter
          reads slotLine() (their local time) knowing where the candidate is. */}
      {i.candidateTz ? <span className="text-xs text-steel" title={i.candidateTz}>· {i.candidateTz}</span> : null}
      {inProgress ? (
        <span className="rounded-full bg-coral/15 px-1.5 py-0.5 text-xs font-semibold text-coral">{t("inProgress")}</span>
      ) : null}
      {i.rescheduleCount > 0 ? (
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
          {t("rescheduled", { count: i.rescheduleCount })}
        </span>
      ) : null}
      {/* idea-87af39c5 — the candidate's RSVP, an early no-show signal. */}
      {i.attendanceStatus === "confirmed" ? (
        <span className="rounded-full bg-moss/15 px-1.5 py-0.5 text-xs font-semibold text-moss">{t("attendanceConfirmed")}</span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <span className="text-xs text-steel">
          {i.reminderSentAt ? t(relayConfigured === false ? "reminderQueued" : "reminderSent") : t("reminderPending")}
        </span>
        <MeetingLinkCell token={i.token} url={i.meetingUrl} onSaved={(url) => updateInvite(i.token, { meetingUrl: url })} />
        {(() => {
          const ev = interviewCalendarEvent(i, { baseUrl: base, meetingUrl: i.meetingUrl });
          return ev ? <AddToCalendar event={ev} uid={`interview-${i.token}`} /> : null;
        })()}
      </span>
    </li>
  );

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-panel">
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <CalendarClock size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>

      {attention.length > 0 ? (
        <div className="mt-2">
          <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-red-700">
            <AlertTriangle size={13} aria-hidden /> {t("attention", { count: attention.length })}
          </p>
          <ul className="mt-1.5 space-y-1">
            {attention.map((i) => (
              <li key={i.id} className="rounded-md border border-red-200 bg-red-50/60 px-3 py-1.5 text-sm">
                <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
                {i.jobTitle ? <span className="text-steel"> · {i.jobTitle}</span> : null}{" "}
                <span className="text-red-700">
                  {i.needsMoreSlots ? t("needsMoreSlots") : t("needsReconcile", { reason: i.reconcileReason ?? "" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #3) — the in-
          progress / just-finished bucket that used to vanish; shown first as the
          most time-sensitive (a call happening now, or one needing a no-show call). */}
      {today.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("today", { count: today.length })}</p>
          <ul className="mt-1.5 space-y-1">{today.map((i) => agendaRow(i, isInProgress(i.slotAt, i.durationMin, loadedAt)))}</ul>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-3">
          <p className="text-meta uppercase tracking-wide text-steel">{t("upcoming", { count: upcoming.length })}</p>
          <ul className="mt-1.5 space-y-1">{upcoming.map((i) => agendaRow(i))}</ul>
        </div>
      ) : null}

      {awaiting.length > 0 ? (
        <details className="mt-3">
          <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
            <Hourglass size={13} aria-hidden /> {t("awaiting", { count: awaiting.length })}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {awaiting.map((i) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
                <span className="font-semibold text-ink">{i.candidateLabel ?? "—"}</span>
                {i.jobTitle ? <span className="text-steel">· {i.jobTitle}</span> : null}
                {/* idea-87af39c5 — a candidate who cancelled attendance is back here
                    awaiting a new time; flag it so the recruiter can follow up. */}
                {i.attendanceStatus === "cancelled" ? (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                    {t("attendanceCancelled")}
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-steel">
                  {t(relayConfigured === false ? "queuedAgo" : "sentAgo", { time: relativeTime(i.createdAt) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
