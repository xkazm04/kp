"use client";

// One confirmed-invite agenda row, shared by the "today" and "upcoming" lists
// in InviteLifecyclePanel so they can't drift. `inProgress` adds a live chip on
// a call happening right now. Split out of ScheduleInviteLifecyclePanel.tsx to
// keep the panel file under the 200-line cap.

import type { useTranslations } from "next-intl";
import { interviewCalendarEvent } from "@/app/_lib/calendar-links";
import { AddToCalendar } from "./ScheduleAddToCalendar";
import { CalendarEventChip } from "./ScheduleCalendarEventChip";
import { MeetingLinkCell } from "./ScheduleMeetingLinkCell";
import { RecruiterControls } from "./ScheduleInviteRecruiterControls";
import type { ScheduleInvite } from "@/app/_lib/schedule-store";
import type { ArmedAction } from "./useScheduleInviteLifecycle";

export function AgendaRow({
  invite: i,
  inProgress = false,
  t,
  slotLine,
  relayConfigured,
  base,
  armed,
  setArmed,
  busy,
  runAction,
  onSavedMeetingUrl,
}: {
  invite: ScheduleInvite;
  inProgress?: boolean;
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
  slotLine: (i: ScheduleInvite) => string;
  relayConfigured: boolean | null;
  base: string;
  armed: ArmedAction | null;
  setArmed: (a: ArmedAction | null) => void;
  busy: string | null;
  runAction: (token: string, action: string, slotAt?: string) => Promise<boolean>;
  onSavedMeetingUrl: (token: string, url: string | null) => void;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-stone-100 bg-paper/40 px-3 py-1.5 text-sm">
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
        {/* W1.4 second half — whether this booking actually reached the connected
            calendar. Best-effort writes have to be visible or a silent failure is
            indistinguishable from a working integration. */}
        <CalendarEventChip state={i.calendarEventState} link={i.calendarEventLink} t={t} />
        <span className="text-xs text-steel">
          {i.reminderSentAt ? t(relayConfigured === false ? "reminderQueued" : "reminderSent") : t("reminderPending")}
        </span>
        <MeetingLinkCell token={i.token} url={i.meetingUrl} onSaved={(url) => onSavedMeetingUrl(i.token, url)} />
        {(() => {
          const ev = interviewCalendarEvent(i, { baseUrl: base, meetingUrl: i.meetingUrl });
          return ev ? <AddToCalendar event={ev} uid={`interview-${i.token}`} /> : null;
        })()}
      </span>
      <RecruiterControls invite={i} t={t} armed={armed} setArmed={setArmed} busy={busy} runAction={runAction} />
    </li>
  );
}
