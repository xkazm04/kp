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

/**
 * Write the confirmed interview onto the calendar. Returns the created event id, or null
 * when the write did not happen — the booking itself is already recorded in kp, so a
 * failed calendar write degrades to "the invite exists but the calendar entry does not"
 * rather than losing the booking.
 */
export async function createInterviewEvent(
  input: {
    startIso: string;
    endIso: string;
    summary: string;
    description?: string;
    attendeeEmails?: readonly string[];
  },
  workspaceId: string
): Promise<string | null> {
  const auth = await accessTokenFor(workspaceId);
  if (!auth) return null;
  const calendarId = getCalendarConnection(workspaceId)?.calendarId ?? "primary";
  const payload = await fetchJson(`${EVENTS_ENDPOINT}/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
      attendees: (input.attendeeEmails ?? []).filter(Boolean).map((email) => ({ email })),
    }),
  });
  const id = (payload as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

// NO ACCOUNT-EMAIL LOOKUP, on purpose. Showing "connected as jana@…" would be nice, and
// every way to get it costs a scope we do not otherwise need: `openid`/`email` (an
// identity scope, on a calendar integration) or `calendar.readonly` (which would also
// hand us every event title we just argued we should not be able to see). Neither is
// worth a label — the operator picked the account seconds earlier on Google's own consent
// screen. `accountEmail` stays null unless a future flow can supply it without widening
// the grant.
