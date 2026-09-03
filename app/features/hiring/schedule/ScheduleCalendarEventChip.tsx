"use client";

// W1.4, second half — what happened to this interview's event on the connected
// calendar, said out loud on the recruiter's row.
//
// The write-back is best-effort by design (the booking is the source of truth and a
// Google outage may never fail a confirm), which is exactly why the outcome has to be
// VISIBLE: a silently-failed write is indistinguishable from a working integration until
// an interviewer misses a call. Two of the five states are genuinely actionable —
// `failed` (retry by rescheduling, or reconnect the calendar) and `orphaned` (a stale
// entry is still sitting on someone's calendar and needs removing by hand) — so those
// two are chips; the rest are quiet single-line facts.

import { CalendarCheck, CalendarOff, CalendarX } from "lucide-react";
import type { useTranslations } from "next-intl";
import { CALENDAR_EVENT_STATES, type CalendarEventState } from "@/app/_lib/calendar/free-busy";

// Message keys spelled out per state rather than interpolated, so next-intl's compile-
// time key checking (global.d.ts AppConfig) still applies — and a state added to
// CALENDAR_EVENT_STATES without a key here is a TYPE error, not a raw key in the UI.
const LABEL: Record<CalendarEventState, "calendarEvent.written" | "calendarEvent.not_connected" | "calendarEvent.failed" | "calendarEvent.removed" | "calendarEvent.orphaned"> = {
  written: "calendarEvent.written",
  not_connected: "calendarEvent.not_connected",
  failed: "calendarEvent.failed",
  removed: "calendarEvent.removed",
  orphaned: "calendarEvent.orphaned",
};

const TONE: Record<CalendarEventState, string> = {
  written: "text-steel",
  not_connected: "text-steel",
  removed: "text-steel",
  failed: "rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800",
  orphaned: "rounded-full bg-red-100 px-1.5 py-0.5 font-semibold text-red-700",
};

function isEventState(value: string | null): value is CalendarEventState {
  return value !== null && (CALENDAR_EVENT_STATES as readonly string[]).includes(value);
}

export function CalendarEventChip({
  state,
  link,
  t,
}: {
  state: string | null;
  link?: string | null;
  t: ReturnType<typeof useTranslations<"scheduleTab.lifecycle">>;
}) {
  // Null before any booking, and an unrecognized stored value (a row written by a newer
  // build) renders nothing rather than a raw key.
  if (!isEventState(state)) return null;
  const label = t(LABEL[state]);
  const Icon = state === "written" ? CalendarCheck : state === "orphaned" || state === "failed" ? CalendarX : CalendarOff;
  const body = (
    <>
      <Icon size={12} aria-hidden /> {label}
    </>
  );
  const className = `inline-flex items-center gap-1 text-micro ${TONE[state]}`;
  // A written event links straight to it — the recruiter's fastest way to check that the
  // entry really is where kp says it is.
  return state === "written" && link ? (
    <a href={link} target="_blank" rel="noreferrer" className={`focus-ring ${className} hover:text-coral`} title={label}>
      {body}
    </a>
  ) : (
    <span className={className}>{body}</span>
  );
}
