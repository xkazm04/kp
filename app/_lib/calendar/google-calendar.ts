import { publicBaseUrl } from "../public-base-url";
import type { BusyInterval } from "./free-busy";
import {
  accessTokenExpired,
  googleOAuthConfig,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "./google-oauth";
import { getCachedAccessToken, getCalendarConnection, getRefreshToken, updateAccessToken } from "./token-store";

// W1.4 — the Google Calendar calls themselves. Everything that decides anything lives in
// free-busy.ts (pure) and google-oauth.ts (pure); this file is the network edge.
//
// DEGRADE, NEVER BLOCK. Scheduling worked before this integration existed and must keep
// working when Google is down, the token is revoked, or nobody ever connected an account.
// So every function here returns "no information" rather than throwing: an outage makes
// kp propose slots the way it always did, instead of taking the schedule tab down with it.

const FREEBUSY_ENDPOINT = "https://www.googleapis.com/calendar/v3/freeBusy";
const EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars";
const TIMEOUT_MS = 8000;

/** Resolve a usable access token for this workspace, refreshing if needed. Null whenever
 *  the integration is not usable, for ANY reason — unconfigured, never connected, revoked,
 *  or a refresh that failed. */
async function accessTokenFor(workspaceId: string): Promise<{ token: string; config: GoogleOAuthConfig } | null> {
  const config = googleOAuthConfig(publicBaseUrl(null));
  if (!config) return null;
  const connection = getCalendarConnection(workspaceId);
  if (!connection?.connected) return null;

  const cached = getCachedAccessToken(workspaceId);
  if (cached && !accessTokenExpired(cached.expiresAt)) return { token: cached.token, config };

  const refresh = getRefreshToken(workspaceId);
  if (!refresh) return null;
  try {
    const tokens = await refreshAccessToken(config, refresh);
    updateAccessToken(tokens, workspaceId);
    return { token: tokens.accessToken, config };
  } catch (err) {
    // A revoked grant lands here (invalid_grant). Logged, not thrown: the operator sees a
    // disconnected integration in the UI, and scheduling carries on unaided.
    console.error(`[calendar] could not refresh the Google access token for workspace "${workspaceId}"`, err);
    return null;
  }
}

/**
 * Is there a calendar integration this workspace could be checked against AT ALL?
 *
 * Mirrors `accessTokenFor`'s two cheap, non-network early exits — deployment not
 * configured, or nobody connected an account — WITHOUT touching the network. It exists so
 * a caller can tell "we did not check because there is nothing to check" from "we tried
 * and got no answer": `fetchBusy` returns null for both, and a recruiter can act on the
 * first (connect a calendar) but not on the second (wait it out). A revoked grant still
 * reads as connected here and its failed refresh surfaces as "unavailable", which is the
 * honest report — kp holds a grant it can no longer use.
 */
export function isCalendarConnected(workspaceId: string): boolean {
  if (!googleOAuthConfig(publicBaseUrl(null))) return false;
  return !!getCalendarConnection(workspaceId)?.connected;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[calendar] Google returned HTTP ${res.status}: ${text.slice(0, 300)}`);
      return null;
    }
    return JSON.parse(text);
  } catch (err) {
    console.error("[calendar] Google request failed", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Busy intervals for the connected calendar in [timeMin, timeMax).
 *
 * Returns null when free/busy is UNAVAILABLE, and [] when the calendar is genuinely free.
 * The distinction matters: [] means "checked, nothing in the way" and null means "we do
 * not know" — a caller that conflated them would show a recruiter a confidently-empty
 * calendar during a Google outage.
 */
export async function fetchBusy(
  window: { timeMin: string; timeMax: string },
  workspaceId: string
): Promise<BusyInterval[] | null> {
  const auth = await accessTokenFor(workspaceId);
  if (!auth) return null;
  const calendarId = getCalendarConnection(workspaceId)?.calendarId ?? "primary";
  const payload = await fetchJson(FREEBUSY_ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: window.timeMin, timeMax: window.timeMax, items: [{ id: calendarId }] }),
  });
  if (!payload || typeof payload !== "object") return null;
  const calendars = (payload as { calendars?: Record<string, { busy?: unknown; errors?: unknown }> }).calendars;
  const entry = calendars?.[calendarId];
  // A per-calendar error (deleted calendar, lost access) is "we do not know", not "free".
  if (!entry || (Array.isArray(entry.errors) && entry.errors.length > 0)) return null;
  const busy = Array.isArray(entry.busy) ? entry.busy : [];
  return busy
    .filter((b): b is { start: string; end: string } => !!b && typeof b === "object" && typeof (b as BusyInterval).start === "string" && typeof (b as BusyInterval).end === "string")
    .map((b) => ({ start: b.start, end: b.end }));
}

/** A bodiless request (DELETE). Returns the HTTP status, or 0 when the request never
 *  completed — `fetchJson` cannot serve this because a successful DELETE answers 204 with
 *  an empty body, which JSON.parse rejects, turning a success into a reported failure. */
async function fetchStatus(url: string, init: RequestInit): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res.status;
  } catch (err) {
    console.error("[calendar] Google request failed", err);
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

/** What an interview event looks like on the wire. `location` carries the meeting link
 *  when the recruiter attached one — the same field the .ics / template-URL fallback
 *  fills, so the written event and the link-only event say the same thing. */
export type InterviewEventInput = {
  startIso: string;
  endIso: string;
  summary: string;
  description?: string;
  location?: string;
  attendeeEmails?: readonly string[];
};

/**
 * The outcome of a calendar WRITE, in the vocabulary the invite persists.
 *
 * Never throws and never a bare boolean: "nobody connected a calendar" is not a failure
 * (it is the documented link-only product) and must not be recorded as one, while a real
 * API error must not be recorded as "written". `gone` is only produced by update/delete
 * and means the event is no longer there — which a delete treats as success (idempotent)
 * and an update treats as a cue to re-create.
 */
export type CalendarWriteResult =
  | { ok: true; eventId: string; eventLink: string | null }
  | { ok: false; reason: "not_connected" | "failed" | "gone" };

function eventBody(input: InterviewEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.startIso },
    end: { dateTime: input.endIso },
    // NO `sendUpdates`, on purpose: kp owns the candidate's confirmation email (with the
    // reschedule link and the .ics), and letting Google send a second, un-branded invite
    // for the same interview would be two "you're booked" mails from one action.
    attendees: (input.attendeeEmails ?? []).filter(Boolean).map((email) => ({ email })),
  };
}

function writtenFrom(payload: unknown): CalendarWriteResult {
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || !id) return { ok: false, reason: "failed" };
  const link = (payload as { htmlLink?: unknown }).htmlLink;
  return { ok: true, eventId: id, eventLink: typeof link === "string" ? link : null };
}

/** Which flavour of "no write happened" applies when there is no usable token: something
 *  the operator can fix (connect an account) vs something they can only wait out (a
 *  revoked grant / a refresh that failed). Mirrors proposeFreeSlots' `unchecked`. */
function noAuthResult(workspaceId: string): CalendarWriteResult {
  return { ok: false, reason: isCalendarConnected(workspaceId) ? "failed" : "not_connected" };
}

/**
 * Write the confirmed interview onto the calendar. The booking itself is already recorded
 * in kp, so a failed calendar write degrades to "the invite exists but the calendar entry
 * does not" rather than losing the booking — the caller records WHICH of those happened.
 */
export async function createInterviewEvent(input: InterviewEventInput, workspaceId: string): Promise<CalendarWriteResult> {
  const auth = await accessTokenFor(workspaceId);
  if (!auth) return noAuthResult(workspaceId);
  const calendarId = getCalendarConnection(workspaceId)?.calendarId ?? "primary";
  const payload = await fetchJson(`${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify(eventBody(input)),
  });
  return payload === null ? { ok: false, reason: "failed" } : writtenFrom(payload);
}

/**
 * Move/refresh an event kp already wrote (a reschedule, a newly attached meeting link).
 *
 * PATCH, not POST: an interview that moves must keep ONE event, or every reschedule
 * leaves a ghost at the old time. `gone` (404/410 — someone deleted it in Google) is
 * reported distinctly so the caller can re-create rather than record a failure for an
 * event the recruiter removed by hand.
 */
export async function updateInterviewEvent(
  eventId: string,
  input: InterviewEventInput,
  workspaceId: string
): Promise<CalendarWriteResult> {
  const auth = await accessTokenFor(workspaceId);
  if (!auth) return noAuthResult(workspaceId);
  const calendarId = getCalendarConnection(workspaceId)?.calendarId ?? "primary";
  const url = `${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify(eventBody(input)),
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status === 404 || res.status === 410) return { ok: false, reason: "gone" };
    if (!res.ok) {
      console.error(`[calendar] Google returned HTTP ${res.status}: ${text.slice(0, 300)}`);
      return { ok: false, reason: "failed" };
    }
    try {
      return writtenFrom(JSON.parse(text));
    } catch {
      return { ok: false, reason: "failed" };
    }
  } catch (err) {
    console.error("[calendar] Google request failed", err);
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Delete the event for an interview that is no longer happening (cancelled, withdrawn,
 * no-showed). An event that is ALREADY gone (404/410) is a success — deletion is
 * idempotent, so a retry after a partial failure converges instead of reporting a
 * permanent error for a calendar that is already in the desired state.
 */
export async function deleteInterviewEvent(
  eventId: string,
  workspaceId: string
): Promise<{ ok: true } | { ok: false; reason: "not_connected" | "failed" }> {
  const auth = await accessTokenFor(workspaceId);
  if (!auth) return { ok: false, reason: isCalendarConnected(workspaceId) ? "failed" : "not_connected" };
  const calendarId = getCalendarConnection(workspaceId)?.calendarId ?? "primary";
  const status = await fetchStatus(
    `${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${auth.token}` } }
  );
  if (status === 404 || status === 410 || (status >= 200 && status < 300)) return { ok: true };
  console.error(`[calendar] deleting event ${eventId} returned HTTP ${status}`);
  return { ok: false, reason: "failed" };
}

// NO ACCOUNT-EMAIL LOOKUP, on purpose. Showing "connected as jana@…" would be nice, and
// every way to get it costs a scope we do not otherwise need: `openid`/`email` (an
// identity scope, on a calendar integration) or `calendar.readonly` (which would also
// hand us every event title we just argued we should not be able to see). Neither is
// worth a label — the operator picked the account seconds earlier on Google's own consent
// screen. `accountEmail` stays null unless a future flow can supply it without widening
// the grant.
