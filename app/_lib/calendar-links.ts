// Solution Ⓑ — client-side "add to calendar" without OAuth. Pure builders for a
// Google Calendar template URL and an Outlook (Office 365) deeplink, plus an
// interview-specific adapter. No secrets, no server, no provider tokens: the user
// clicks and their own calendar opens pre-filled. The .ics half is the canonical
// buildIcs in export-utils.ts (this module deliberately does NOT re-implement it).
// A later Solution Ⓐ (OAuth two-way sync) can reuse the same CalendarEvent shape.

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

// Default interview length when the invite didn't capture one.
const DEFAULT_DURATION_MIN = 45;

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
  return { title, start: inv.slotAt, end, description, location: meetingUrl ?? "Online interview" };
}
