// The calendar edge's two missing manners: it must not call out in an air-gapped install,
// and it must not treat "ask me again in a second" as "your calendar is unavailable".
//
// BEFORE: `grep KP_OFFLINE app/_lib/calendar` was empty — the one egress in the repo that
// ignored offline mode, so an air-gapped deployment reached Google, was rejected by the
// global fetch guard, and logged "[calendar] Google request failed" at every free/busy
// lookup: an error for a configuration that is working exactly as the operator asked. And
// `grep -E '429|retry' app/_lib/calendar/*.ts` matched prose only — a single transient
// throttle collapsed the whole availability check to "unavailable" with no second attempt
// and no reading of the delay Google itself named.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "calendar-edge-fetch-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { fetchBusy, createInterviewEvent, deleteInterviewEvent } = await import("./google-calendar.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");
const { MAX_RETRY_AFTER_MS, DEFAULT_RETRY_AFTER_MS, retryAfterMs, isRetryableStatus } = await import("./edge-fetch.ts");

after(() => cleanupUnitDb());

const WINDOW = { timeMin: "2026-03-02T08:00:00.000Z", timeMax: "2026-03-02T18:00:00.000Z" };
const EVENT = {
  startIso: "2026-03-02T09:00:00.000Z",
  endIso: "2026-03-02T09:45:00.000Z",
  summary: "Interview · Ada — Backend",
};

function connectCalendar(): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        // Valid for an hour, so nothing on these paths needs a token REFRESH — every
        // request the fake sees is the calendar call itself.
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
      },
      accountEmail: null,
      calendarId: "primary",
      missingScopes: [],
    },
    DEFAULT_WORKSPACE_ID
  );
}

type Scripted = { status: number; body?: string; retryAfter?: string };

const realFetch = globalThis.fetch;
let calls: string[] = [];
let bodies: string[] = [];

/** Answer each request with the next scripted response; an unscripted request is a test
 *  failure rather than a silent extra round trip. */
function scriptGoogle(...responses: Scripted[]): void {
  calls = [];
  bodies = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url instanceof Request ? url.url : url));
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const next = responses[i++];
    if (!next) throw new Error(`unscripted request #${i} to ${String(url)}`);
    const headers = new Headers();
    if (next.retryAfter !== undefined) headers.set("retry-after", next.retryAfter);
    return new Response(next.body ?? "", { status: next.status, headers });
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_OFFLINE;
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("KP_OFFLINE: every calendar call answers 'unknown' WITHOUT touching the network", async () => {
  connectCalendar();
  process.env.KP_OFFLINE = "1";
  // Nothing may be scripted: an air-gapped install makes no request at all.
  scriptGoogle();

  const busy = await fetchBusy(WINDOW, DEFAULT_WORKSPACE_ID);
  assert.equal(busy, null, "null is 'we do not know' — never [], which means 'all day is free'");

  const created = await createInterviewEvent(EVENT, DEFAULT_WORKSPACE_ID);
  assert.deepEqual(created, { ok: false, reason: "failed" }, "a write that did not land, in the vocabulary the invite persists");

  const deleted = await deleteInterviewEvent("evt-1", DEFAULT_WORKSPACE_ID);
  assert.deepEqual(deleted, { ok: false, reason: "failed" });

  assert.deepEqual(calls, [], "the offline predicate is consulted FIRST — no egress is attempted");
});

test("a throttled free/busy lookup is retried exactly once, and the answer stands", async () => {
  connectCalendar();
  scriptGoogle(
    { status: 429, retryAfter: "0.05" },
    { status: 200, body: JSON.stringify({ calendars: { primary: { busy: [{ start: WINDOW.timeMin, end: WINDOW.timeMax }] } } }) }
  );
  const busy = await fetchBusy(WINDOW, DEFAULT_WORKSPACE_ID);
  assert.equal(calls.length, 2, "one retry, not zero and not a storm");
  assert.deepEqual(busy, [{ start: WINDOW.timeMin, end: WINDOW.timeMax }], "the second answer is the answer");
});

test("a 503 on an event WRITE is retried once too", async () => {
  connectCalendar();
  scriptGoogle({ status: 503 }, { status: 200, body: JSON.stringify({ id: "evt-9", htmlLink: "https://cal/evt-9" }) });
  const created = await createInterviewEvent(EVENT, DEFAULT_WORKSPACE_ID);
  assert.equal(calls.length, 2);
  assert.deepEqual(created, { ok: true, eventId: "evt-9", eventLink: "https://cal/evt-9" });
  // And the body Google was handed states its time zone. A bare `dateTime` with no offset
  // is read in the CALENDAR's zone, so the event was right only because kp's instants
  // happen to be UTC — an implied zone is an interview at the wrong hour waiting to happen.
  const sent = JSON.parse(bodies[0]) as { start: { dateTime: string; timeZone?: string }; end: { timeZone?: string } };
  assert.equal(sent.start.timeZone, "UTC");
  assert.equal(sent.end.timeZone, "UTC");
  assert.equal(bodies[0], bodies[1], "the retry repeats the same event, byte for byte");
});

test("a second throttle is NOT retried — the honest 'unavailable' beats a storm", async () => {
  connectCalendar();
  scriptGoogle({ status: 429, retryAfter: "0" }, { status: 429, retryAfter: "0" });
  const busy = await fetchBusy(WINDOW, DEFAULT_WORKSPACE_ID);
  assert.equal(calls.length, 2, "exactly one retry");
  assert.equal(busy, null);
});

test("a non-transient status is answered, never repeated", async () => {
  connectCalendar();
  scriptGoogle({ status: 400, body: "bad request" });
  const busy = await fetchBusy(WINDOW, DEFAULT_WORKSPACE_ID);
  assert.equal(calls.length, 1, "a 400 is our bug; repeating it buys nothing");
  assert.equal(busy, null);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(429) && isRetryableStatus(503), true);
});

test("Retry-After is honoured in both wire forms — and capped", () => {
  const now = Date.parse("2026-03-02T09:00:00.000Z");
  assert.equal(retryAfterMs("1", now), 1000, "delay-seconds");
  assert.equal(retryAfterMs("300", now), MAX_RETRY_AFTER_MS, "Google may ask for five minutes; a booking page may not wait it");
  assert.equal(retryAfterMs("Mon, 02 Mar 2026 09:00:01 GMT", now), 1000, "the HTTP-date form");
  assert.equal(retryAfterMs("Mon, 02 Mar 2026 08:00:00 GMT", now), 0, "a date already past means 'now'");
  assert.equal(retryAfterMs(null, now), DEFAULT_RETRY_AFTER_MS, "no header at all");
  assert.equal(retryAfterMs("soon-ish", now), DEFAULT_RETRY_AFTER_MS, "malformed");
  assert.ok(MAX_RETRY_AFTER_MS <= 2000, "the cap is stated, and short");
});
