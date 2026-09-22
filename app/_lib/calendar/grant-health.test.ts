// GRANT HEALTH — a revoked or unreadable Google grant is a CHRONIC failure, not a blip.
//
// Before this, a refresh that Google answered with `invalid_grant` was console.error'd and
// forgotten: the connection kept reading "connected" (token-store's `!!refresh_token`),
// every candidate page load spent a token round trip on a grant that can never work again,
// and the recruiter saw "the calendar lookup failed" — the same words as a Google outage,
// which asks them to wait for a problem only a reconnect fixes.
//
// The contract pinned here:
//   - `invalid_grant` on refresh persists health 'revoked' (+ when);
//   - a decrypt throw persists 'undecryptable';
//   - an unhealthy grant makes NO network call on the read or write path;
//   - the recruiter status becomes `needs_reconnect` — never on a transient 5xx;
//   - a successful re-consent clears it;
//   - the operator's status route reports the health and how many upcoming interviews
//     never reached the calendar (this workspace only).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";
import Database from "better-sqlite3";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

const ORIGINAL_KEY = "grant-health-test-secret";
process.env.KP_SECRET = ORIGINAL_KEY;
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { fetchBusy, createInterviewEvent } = await import("./google-calendar.ts");
const { proposeFreeSlots } = await import("./available-slots.ts");
const { saveCalendarConnection, deleteCalendarConnection, getCalendarConnection } = await import("./token-store.ts");
const { createScheduleInvite, countUnsyncedUpcomingInvites } = await import("../schedule-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");
const { GET } = await import("../../api/calendar/google/route.ts");

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;
const WINDOW = { timeMin: "2026-03-02T08:00:00.000Z", timeMax: "2026-03-02T18:00:00.000Z" };

// ── A programmable fetch with a call counter ──────────────────────────────────────────
type Handler = (url: string) => Response;
let calls: string[] = [];
let handler: Handler = (url) => {
  throw new Error(`unexpected outbound request in test: ${url}`);
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  calls.push(u);
  return handler(u);
}) as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Google's actual answer to a refresh against a revoked grant. */
const invalidGrant: Handler = (url) => {
  if (url.includes("oauth2.googleapis.com/token")) {
    return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  }
  throw new Error(`unexpected outbound request in test: ${url}`);
};

/** Connect with an EXPIRED access token, so the next call must refresh. */
function connectExpired(): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: "stale-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"],
      },
      accountEmail: null,
      calendarId: "primary",
      missingScopes: [],
    },
    WS
  );
}

/** Connect with a still-valid access token (no refresh needed). */
function connectFresh(): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: "fresh-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events"],
      },
      accountEmail: null,
      calendarId: "primary",
      missingScopes: [],
    },
    WS
  );
}

beforeEach(() => {
  calls = [];
  process.env.KP_SECRET = ORIGINAL_KEY;
  deleteCalendarConnection(WS);
});

test("invalid_grant on refresh persists health 'revoked' with a timestamp", async () => {
  connectExpired();
  handler = invalidGrant;
  const busy = await fetchBusy(WINDOW, WS);
  assert.equal(busy, null, "still the documented unknown, never a thrown error");
  const conn = getCalendarConnection(WS);
  assert.equal(conn?.health, "revoked");
  assert.ok(conn?.healthAt && !Number.isNaN(Date.parse(conn.healthAt)), "healthAt is an ISO instant");
  assert.equal(conn?.connected, true, "the row is kept: Disconnect and Reconnect both stay available");
});

test("a revoked grant makes ZERO network calls on the read and the write path", async () => {
  connectExpired();
  handler = invalidGrant;
  await fetchBusy(WINDOW, WS);
  assert.equal(getCalendarConnection(WS)?.health, "revoked");

  calls = [];
  handler = (url) => {
    throw new Error(`a dead grant must not reach Google: ${url}`);
  };
  assert.equal(await fetchBusy(WINDOW, WS), null);
  const write = await createInterviewEvent(
    { startIso: "2026-03-02T10:00:00.000Z", endIso: "2026-03-02T10:45:00.000Z", summary: "Interview" },
    WS
  );
  assert.deepEqual(write, { ok: false, reason: "failed" }, "the booking records a failed write, as before");
  assert.equal(calls.length, 0, `no token round trip per page load; saw ${calls.join(", ")}`);
});

test("proposeFreeSlots: revoked -> needs_reconnect; a 503 twice on a healthy grant -> still unavailable", async () => {
  connectExpired();
  handler = invalidGrant;
  const revoked = await proposeFreeSlots([], WS, 6);
  assert.equal(revoked.calendarStatus, "needs_reconnect");
  assert.equal(revoked.calendarChecked, false);
  assert.ok(revoked.slots.length > 0, "degrade, never block: the candidate still gets times");

  deleteCalendarConnection(WS);
  connectFresh();
  handler = (url) => {
    if (url.includes("/freeBusy")) return json(503, { error: { message: "backend error" } }, { "retry-after": "0" });
    throw new Error(`unexpected outbound request in test: ${url}`);
  };
  const outage = await proposeFreeSlots([], WS, 6);
  assert.equal(outage.calendarStatus, "unavailable", "a transient outage is a wait, not a reconnect");
  assert.equal(getCalendarConnection(WS)?.health, "ok", "and it never marks the grant revoked");
});

test("a stored token that no longer decrypts -> health 'undecryptable' -> needs_reconnect", async () => {
  connectFresh();
  process.env.KP_SECRET = "a-different-secret-entirely";
  handler = (url) => {
    throw new Error(`an unreadable credential is decided locally: ${url}`);
  };
  const proposed = await proposeFreeSlots([], WS, 6);
  assert.equal(getCalendarConnection(WS)?.health, "undecryptable");
  assert.equal(proposed.calendarStatus, "needs_reconnect");
  assert.equal(calls.length, 0);
});

test("a successful re-consent resets health to 'ok' and clears healthAt", async () => {
  connectExpired();
  handler = invalidGrant;
  await fetchBusy(WINDOW, WS);
  assert.equal(getCalendarConnection(WS)?.health, "revoked");

  connectFresh(); // what the OAuth callback does after the operator reconnects
  const conn = getCalendarConnection(WS);
  assert.equal(conn?.health, "ok");
  assert.equal(conn?.healthAt, null);
});

test("GET /api/calendar/google reports the health and this workspace's unsynced upcoming interviews", async () => {
  connectExpired();
  handler = invalidGrant;
  await fetchBusy(WINDOW, WS);

  // Fixtures: four invites, shaped directly (the booking flow is not what is under test).
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const mk = (entryId: string) => createScheduleInvite({ entryId }).token;
  const oursFailed1 = mk("gh-e1");
  const oursFailed2 = mk("gh-e2");
  const oursWritten = mk("gh-e3");
  const oursPastFailed = mk("gh-e4");
  const theirsFailed = mk("gh-e5");
  const raw = new Database(process.env.KP_DB_PATH!);
  try {
    const set = raw.prepare(
      `UPDATE schedule_invites SET status = 'confirmed', slot_at = ?, calendar_event_state = ?, workspace_id = ? WHERE token = ?`
    );
    set.run(future, "failed", WS, oursFailed1);
    set.run(future, "failed", WS, oursFailed2);
    set.run(future, "written", WS, oursWritten);
    set.run(past, "failed", WS, oursPastFailed);
    set.run(future, "failed", "ws-someone-else", theirsFailed);
  } finally {
    raw.close();
  }

  assert.equal(countUnsyncedUpcomingInvites(WS), 2);
  assert.equal(countUnsyncedUpcomingInvites("ws-someone-else"), 1);

  const res = await GET();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { connection: { health: string; healthAt: string | null }; unsyncedUpcoming: number };
  assert.equal(body.connection.health, "revoked");
  assert.ok(body.connection.healthAt);
  assert.equal(body.unsyncedUpcoming, 2, "future + confirmed + failed, in THIS workspace only");
});
