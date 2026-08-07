import { interviewCalendarEvent } from "../calendar-links";
import { recordCalendarEvent, type ScheduleInvite } from "../schedule-store";
import type { CalendarEventState } from "./free-busy";
import {
  createInterviewEvent,
  deleteInterviewEvent,
  updateInterviewEvent,
  type InterviewEventInput,
} from "./google-calendar";

// W1.4, second half — "a confirmed slot writes a real event on both sides."
//
// The free/busy READ shipped; the WRITE did not. `createInterviewEvent` sat fully
// implemented with zero call sites while the `calendar.events` scope was requested at
// consent time and never exercised, and write-back stayed link-only (the .ics / template
// URL in calendar-links.ts). This module is the seam that finally uses it.
//
// THREE RULES, in priority order:
//
// 1. THE BOOKING IS THE SOURCE OF TRUTH. Every function here is best-effort and returns
//    a state instead of throwing. A Google outage must never turn a confirmed interview
//    into an error response, a half-committed booking, or a rolled-back slot — kp booked
//    interviews before this integration existed and must keep booking them when Google
//    is down. (Same contract free/busy already holds: unknown proceeds.)
// 2. ONE EVENT PER INTERVIEW, FOR ITS WHOLE LIFE. The provider event id is persisted on
//    the invite, so a reschedule PATCHes that event rather than creating a second one at
//    the new time, and a cancel/no-show/withdrawal deletes exactly it. A retry after a
//    partial failure converges instead of duplicating.
// 3. FAILURE IS RECORDED, NOT SWALLOWED. `calendar_event_state` says which of written /
//    not_connected / failed / removed / orphaned actually happened, and the recruiter
//    panel renders the two states a human can act on.
//
// The event's BODY is not invented here: `interviewCalendarEvent` (calendar-links.ts)
// already composes the title, description (stage, join link, reschedule URL) and location
// for the .ics and the "add to calendar" template URL. The written event is that same
// event — so the real calendar entry and the link-only fallback can never disagree.

/** The fields this seam needs off an invite. `ScheduleInvite` satisfies it; declaring the
 *  subset keeps the dependency honest and the unit tests small. */
export type SyncableInvite = Pick<
  ScheduleInvite,
  "token" | "workspaceId" | "candidateLabel" | "jobTitle" | "slotAt" | "durationMin" | "meetingUrl" | "calendarEventId"
>;

/** Only a plausible address is offered to Google as an attendee — the entry's `contact`
 *  column also holds phone numbers and free text, and a malformed attendee makes the
 *  whole event write fail (400), i.e. one bad contact record would cost the event. */
function attendeeList(email: string | null | undefined): string[] {
  const clean = typeof email === "string" ? email.trim() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? [clean] : [];
}

function eventInput(invite: SyncableInvite, opts: { attendeeEmail?: string | null; baseUrl?: string | null }): InterviewEventInput | null {
  const ev = interviewCalendarEvent(invite, { baseUrl: opts.baseUrl ?? undefined, meetingUrl: invite.meetingUrl });
  if (!ev) return null; // no booked slot ⇒ nothing to write
  return {
    startIso: ev.start,
    endIso: ev.end,
    summary: ev.title,
    description: ev.description,
    location: ev.location,
    attendeeEmails: attendeeList(opts.attendeeEmail),
  };
}

/** Persist an outcome without ever letting bookkeeping break the caller's response. */
function record(token: string, state: CalendarEventState, eventId?: string | null, eventLink?: string | null): CalendarEventState {
  try {
    recordCalendarEvent(token, { state, eventId, eventLink });
  } catch (err) {
    console.error(`[calendar] could not record the event state for invite "${token}"`, err);
  }
  return state;
}

/**
 * Put the confirmed interview on the connected calendar — creating the event the first
 * time, UPDATING it on every later booking change (reschedule, accepted proposal,
 * recruiter move, a newly attached meeting link).
 *
 * Returns the recorded state, or null when there is nothing to write (no booked slot).
 * Never throws.
 */
export async function syncInterviewEvent(
  invite: SyncableInvite,
  opts: { attendeeEmail?: string | null; baseUrl?: string | null } = {}
): Promise<CalendarEventState | null> {
  try {
    const input = eventInput(invite, opts);
    if (!input) return null;
    let result = invite.calendarEventId
      ? await updateInterviewEvent(invite.calendarEventId, input, invite.workspaceId)
      : await createInterviewEvent(input, invite.workspaceId);
    // The event kp wrote was deleted in Google by hand. That is not a failure to report
    // to the recruiter — it is a cue to write the interview back onto the calendar.
    if (!result.ok && result.reason === "gone") {
      result = await createInterviewEvent(input, invite.workspaceId);
    }
    if (result.ok) return record(invite.token, "written", result.eventId, result.eventLink);
    return record(invite.token, result.reason === "not_connected" ? "not_connected" : "failed");
  } catch (err) {
    // Defence in depth: the edge already swallows its own errors, so reaching here means
    // something unexpected. The booking still stands.
    console.error(`[calendar] event write-back threw for invite "${invite.token}"`, err);
    return record(invite.token, "failed");
  }
}

/**
 * Take the interview off the calendar — it is cancelled, withdrawn, or a no-show.
 *
 * Deletes exactly the event kp created (never a search-and-guess), and only when there is
 * one: an invite that never got an event has nothing to remove and is left alone. A
 * delete that does not land yields 'orphaned' — the honest statement that a stale entry
 * is still sitting on someone's calendar — and KEEPS the event id so a later attempt can
 * still find it. Returns null when there was nothing to do. Never throws.
 */
export async function removeInterviewEvent(invite: SyncableInvite): Promise<CalendarEventState | null> {
  if (!invite.calendarEventId) return null;
  try {
    const result = await deleteInterviewEvent(invite.calendarEventId, invite.workspaceId);
    return record(invite.token, result.ok ? "removed" : "orphaned");
  } catch (err) {
    console.error(`[calendar] event removal threw for invite "${invite.token}"`, err);
    return record(invite.token, "orphaned");
  }
}
