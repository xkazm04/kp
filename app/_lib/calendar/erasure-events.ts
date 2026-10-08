import { erasedInvitesWithCalendarEvent, invitesWithCalendarEvent } from "../schedule-store";
import { removeInterviewEvent } from "./event-sync";

// Erasure removes the interviewer's calendar event (ADR 0021, amendment 2026-10-08).
//
// An erased candidate's email stays an attendee on the interviewer's Google Calendar
// unless the event is deleted. anonymizeEntry is synchronous and makes no network call, so
// the delete happens AFTER its commit, in two places that share this module:
//
//   1. removeErasedEntryEvents — the immediate attempt on the candidate's own door.
//   2. sweepErasedInterviewEvents — the retry queue. Its state is the invite row itself:
//      an anonymized entry's invite that still holds `calendar_event_id`. It therefore also
//      reaches the consent-expiry door, an erasure whose attempt failed or never ran, and
//      entries erased before this change. No new table, no stored address.
//
// Both are best-effort and never throw: the erasure is already done, and a calendar
// outage must not undo or fail it. A delete that never lands stays 'orphaned' with its
// event id kept, which is also what the recruiter panel renders.
//
// `sendUpdates: "none"` — an erased person must not get a cancellation mail from Google.

/** Minimum gap between two attempts on the same event (measured from calendar_event_at,
 *  stamped by every attempt). Slow on purpose: an outage is retried, never hammered. */
export const ERASURE_EVENT_RETRY_SPACING_MS = 15 * 60_000;
/** Cap on events attempted per sweep tick. */
export const ERASURE_EVENT_SWEEP_LIMIT = 25;

export type ErasureEventCounts = { removed: number; orphaned: number; skipped: number };

type Invite = Parameters<typeof removeInterviewEvent>[0];

async function removeAll(invites: Invite[]): Promise<ErasureEventCounts> {
  const counts: ErasureEventCounts = { removed: 0, orphaned: 0, skipped: 0 };
  for (const invite of invites) {
    const state = await removeInterviewEvent(invite, { sendUpdates: "none" });
    if (state === "removed") counts.removed += 1;
    else if (state === "orphaned") counts.orphaned += 1;
    else counts.skipped += 1;
  }
  return counts;
}

/** Delete the events of every invite of an erased entry. Invites are read fresh here —
 *  after the commit — because the scrub replaced their tokens. Never throws. */
export async function removeErasedEntryEvents(entryId: string, workspaceId: string): Promise<ErasureEventCounts> {
  try {
    return await removeAll(invitesWithCalendarEvent(entryId, workspaceId));
  } catch (err) {
    console.error(`[calendar] erasure event removal failed for entry "${entryId}"`, err);
    return { removed: 0, orphaned: 0, skipped: 0 };
  }
}

/** The retry sweep: events still standing for anonymized entries, oldest first, past the
 *  retry spacing. Each delete uses the invite's own workspace connection. Never throws. */
export async function sweepErasedInterviewEvents(
  now: Date = new Date(),
  limit: number = ERASURE_EVENT_SWEEP_LIMIT
): Promise<ErasureEventCounts> {
  try {
    const retryBefore = new Date(now.getTime() - ERASURE_EVENT_RETRY_SPACING_MS).toISOString();
    return await removeAll(erasedInvitesWithCalendarEvent(retryBefore, limit));
  } catch (err) {
    console.error("[calendar] erased-event sweep failed", err);
    return { removed: 0, orphaned: 0, skipped: 0 };
  }
}
