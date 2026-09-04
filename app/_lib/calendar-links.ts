// Solution Ⓑ — client-side "add to calendar" without OAuth. Pure builders for a
// Google Calendar template URL and an Outlook (Office 365) deeplink, plus an
// interview-specific adapter. No secrets, no server, no provider tokens: the user
// clicks and their own calendar opens pre-filled. The .ics half is the canonical
// buildIcs in export-utils.ts (this module deliberately does NOT re-implement it).
// A later Solution Ⓐ (OAuth two-way sync) can reuse the same CalendarEvent shape.

import { DEFAULT_INTERVIEW_MINUTES } from "./calendar/constants";

export type CalendarEvent = {
  title: string;
  /** ISO instant of the start. */
  start: string;
  /** ISO instant of the end. */
  end: string;
  description?: string;
  location?: string;
};

// iCal UTC "basic" form: 20260601T140000Z — Google's `dates` and .ics DTSTART/DTEND.
export function icalUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Google Calendar prefilled-event URL (action=TEMPLATE). */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${icalUtc(ev.start)}/${icalUtc(ev.end)}`,
    details: ev.description ?? "",
    location: ev.location ?? "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook (Office 365 work/school) compose deeplink. startdt/enddt take ISO 8601. */
export function outlookCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    body: ev.description ?? "",
    startdt: ev.start,
    enddt: ev.end,
    location: ev.location ?? "",
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

// Duration (minutes) between the event's start and end — for the .ics builder in
// export-utils, which is parametrized by duration rather than an end instant.
export function eventDurationMin(ev: CalendarEvent): number {
  return Math.max(1, Math.round((new Date(ev.end).getTime() - new Date(ev.start).getTime()) / 60_000));
}

// Fields a confirmed interview carries (a subset of ScheduleInvite), kept structural
// so this module has no store/runtime dependency.
export type InterviewLike = {
  token: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  slotAt: string | null;
  durationMin: number | null;
};

// Default interview length when the invite didn't capture one. Exported so the
// candidate-side builder (candidateCalendarEvent) derives the SAME fallback —
// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #5): SchedulePicker
// used to inline `durationMin ?? 30` while this file used 45, so an invite with no
// planned length blocked 30 min on the candidate's calendar and 45 on the
// recruiter's for one interview. One constant, one duration.
// … and it now IMPORTS that constant rather than re-typing it: free-busy.ts declared its
// own 45 under another name, so one number lived in two files that never met.
export const DEFAULT_DURATION_MIN = DEFAULT_INTERVIEW_MINUTES;

// Neutral location when no real join link is attached — shared fallback so the
// candidate and recruiter events agree on the location text too (bug-ui-scan
// -2026-07-09 #5). The candidate UI localizes it (passes a translated string);
// the recruiter side uses this English default.
export const DEFAULT_LOCATION = "Online interview";

/** Build the polished calendar event for a confirmed interview. Returns null when the
 *  invite has no slot yet. `baseUrl` (the app origin) turns the reschedule page into a
 *  clickable link in the event body. */
export function interviewCalendarEvent(
  inv: InterviewLike,
  opts?: { baseUrl?: string; stage?: string | null; matchScore?: number | null; meetingUrl?: string | null }
): CalendarEvent | null {
  if (!inv.slotAt) return null;
  const durMin = inv.durationMin && inv.durationMin > 0 ? inv.durationMin : DEFAULT_DURATION_MIN;
  const end = new Date(new Date(inv.slotAt).getTime() + durMin * 60_000).toISOString();
  const who = inv.candidateLabel ?? "Candidate";
  const title = `Interview · ${who}${inv.jobTitle ? ` — ${inv.jobTitle}` : ""}`;
  const rescheduleUrl = opts?.baseUrl ? `${opts.baseUrl.replace(/\/$/, "")}/schedule/${inv.token}` : null;
  const meetingUrl = opts?.meetingUrl?.trim() ? opts.meetingUrl.trim() : null;
  const description = [
    `Interview with ${who}${inv.jobTitle ? ` for ${inv.jobTitle}` : ""}.`,
    opts?.stage ? `Stage: ${opts.stage}.` : null,
    typeof opts?.matchScore === "number" ? `Match score: ${opts.matchScore}/100.` : null,
    meetingUrl ? `Join: ${meetingUrl}` : null,
    "",
    rescheduleUrl ? `Confirm, reschedule, or cancel: ${rescheduleUrl}` : null,
    "Scheduled with KP.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  // A real join link becomes the event location; otherwise a neutral placeholder.
  return { title, start: inv.slotAt, end, description, location: meetingUrl ?? DEFAULT_LOCATION };
}

// Candidate-side "add to calendar" event for the booked card. Kept HERE (not
// inlined in SchedulePicker.tsx) so it shares DEFAULT_DURATION_MIN and the
// location fallback with the recruiter's interviewCalendarEvent — bug-ui-scan
// -2026-07-09 (interview-scheduling-prep-rubric #5). Title/description/location
// text are passed in already-localized (the candidate UI translates them); the
// duration and location-fallback DEFAULTS come from one place so both calendars
// block the same length and name the same location for one interview. Returns
// null when there's no booked slot yet.
export function candidateCalendarEvent(
  inv: { slotAt: string | null; durationMin: number | null; meetingUrl?: string | null },
  strings: { title: string; description: string; joinLabel?: string; locationOnline: string }
): CalendarEvent | null {
  if (!inv.slotAt) return null;
  const durMin = inv.durationMin && inv.durationMin > 0 ? inv.durationMin : DEFAULT_DURATION_MIN;
  const end = new Date(new Date(inv.slotAt).getTime() + durMin * 60_000).toISOString();
  const meetingUrl = inv.meetingUrl?.trim() ? inv.meetingUrl.trim() : null;
  const description =
    meetingUrl && strings.joinLabel ? `${strings.description}\n${strings.joinLabel}: ${meetingUrl}` : strings.description;
  return { title: strings.title, start: inv.slotAt, end, description, location: meetingUrl ?? strings.locationOnline };
}
