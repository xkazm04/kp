// A confirmed slot must write a REAL event on the connected calendar — and that event
// must survive the whole interview lifecycle as exactly one event.
//
// W1.4's acceptance criterion had two halves ("slot suggestions respect real free/busy; a
// confirmed slot writes a real event on both sides"). The first shipped; the second did
// not, while `createInterviewEvent` sat fully implemented with zero call sites and the
// granted `calendar.events` scope was never exercised. These tests pin the second half
// end-to-end through the REAL routes with a stubbed Google edge (globalThis.fetch),
// because the risk was never in the maths — it is in whether the call sites exist at all,
// and in what they do on retry, reschedule and failure.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
// TYPE-ONLY next/server import, deliberately — see calendar-conflict.test.ts: a
// junction-linked worktree resolves next/server through two module identities, so
// constructing a real NextRequest throws.
import type { NextRequest } from "next/server";

const req = (url: string, init?: RequestInit): NextRequest => new Request(url, init) as unknown as NextRequest;
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "calendar-writeback-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { GET, POST } = await import("./[token]/route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createScheduleInvite, getScheduleInviteByToken } = await import("../../_lib/schedule-store.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("../../_lib/calendar/token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

const params = (token: string) => ({ params: Promise.resolve({ token }) });

let seq = 0;
function inviteFixture() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `wb-c${seq}`,
    candidateLabel: `Writeback Candidate ${seq}`,
    jobId: `wb-job-${seq}`,
    jobTitle: "Writeback Test Role",
    contact: `wb-c${seq}@example.com`,
  });
  return createScheduleInvite({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobTitle: entry.jobTitle,
    durationMin: 45,
  });
}

async function slotsFor(token: string): Promise<string[]> {
  const res = await GET(req(`http://localhost/api/schedule/${token}`), params(token));
  assert.equal(res.status, 200);
  return (await res.json()).slots.map((s: { value: string }) => s.value);
}

function post(token: string, body: unknown): Promise<Response> {
  return POST(
    req(`http://localhost/api/schedule/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    params(token)
  );
}

function connectCalendar(workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
      accountEmail: null,
      calendarId: "primary",
      missingScopes: [],
    },
    workspaceId
  );
}

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

type EventCall = { method: string; url: string; body: Record<string, unknown> | null };
let eventCalls: EventCall[] = [];

/** Free/busy always answers "clear"; the EVENTS endpoint is what these tests watch.
 *  `mode`:
 *    "ok"      — creates/patches succeed with an id + htmlLink, deletes answer 204.
 *    "down"    — every events call is a 500 (a real outage / API error).
 *    "delgone" — writes succeed; DELETE answers 500 (the orphan path). */
function stubGoogle(mode: "ok" | "down" | "delgone" = "ok"): void {
  eventCalls = [];
  let created = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (href.includes("freeBusy")) {
      return new Response(JSON.stringify({ calendars: { primary: { busy: [] } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("/calendar/v3/calendars/")) {
      eventCalls.push({ method, url: href, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (mode === "down") return new Response("events api exploded", { status: 500 });
      if (method === "DELETE") return new Response(null, { status: mode === "delgone" ? 500 : 204 });
      const id = method === "POST" ? `evt-${(created += 1)}-${eventCalls.length}` : href.split("/events/")[1];
      return new Response(JSON.stringify({ id, htmlLink: `https://calendar.google.com/event?eid=${id}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected outbound request in test: ${href}`);
  }) as typeof globalThis.fetch;
}

const writes = () => eventCalls.filter((c) => c.method === "POST");
const patches = () => eventCalls.filter((c) => c.method === "PATCH");
const deletes = () => eventCalls.filter((c) => c.method === "DELETE");

before(() => {
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("confirming a slot writes a real event, and its id + link land on the invite", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("ok");
  const slot = (await slotsFor(invite.token))[0];

  const res = await post(invite.token, { slotAt: slot });
  assert.equal(res.status, 200);

  assert.equal(writes().length, 1, "exactly one event is created for one booking");
  const body = writes()[0].body!;
  assert.deepEqual(body.start, { dateTime: slot }, "the event starts at the confirmed instant");
  assert.match(String(body.summary), /Writeback Candidate/, "the event names the candidate");
  assert.deepEqual(body.attendees, [{ email: `wb-c${seq}@example.com` }], "the candidate joins as an attendee");
  assert.equal(
    "sendUpdates" in (body as Record<string, unknown>),
    false,
    "kp owns the candidate's confirmation mail — Google must not send a second invite"
  );

  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "written");
  assert.ok(stored.calendarEventId, "the provider event id is persisted (the idempotency handle)");
  assert.match(String(stored.calendarEventLink), /^https:\/\/calendar\.google\.com\//);
});

test("a reschedule UPDATES the same event — it never leaves a ghost at the old time", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("ok");
  const slots = await slotsFor(invite.token);
  await post(invite.token, { slotAt: slots[0] });
  const firstEventId = getScheduleInviteByToken(invite.token)!.calendarEventId;

  const moveTo = (await slotsFor(invite.token)).find((s) => s !== slots[0])!;
  const res = await post(invite.token, { slotAt: moveTo, reschedule: true });
  assert.equal(res.status, 200);

  assert.equal(writes().length, 1, "the reschedule must NOT create a second event");
  assert.equal(patches().length, 1, "it patches the one that exists");
  assert.match(patches()[0].url, new RegExp(`/events/${firstEventId}$`), "and patches exactly kp's event");
  assert.deepEqual(patches()[0].body!.start, { dateTime: moveTo }, "moved to the new instant");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventId, firstEventId, "one event for the whole life of the interview");
  assert.equal(stored.calendarEventState, "written");
});

test("withdrawing DELETES the event and clears the handle — nothing is orphaned", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("ok");
  const slot = (await slotsFor(invite.token))[0];
  await post(invite.token, { slotAt: slot });
  const eventId = getScheduleInviteByToken(invite.token)!.calendarEventId;

  const res = await post(invite.token, { withdraw: true });
  assert.equal(res.status, 200);
  assert.equal(deletes().length, 1, "the calendar entry goes when the interview does");
  assert.match(deletes()[0].url, new RegExp(`/events/${eventId}$`));
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.status, "declined");
  assert.equal(stored.calendarEventState, "removed");
  assert.equal(stored.calendarEventId, null, "the handle is cleared, so a re-booking creates a fresh event");
});

test("an RSVP cancel frees the calendar too, and re-booking creates a NEW event", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("ok");
  const slot = (await slotsFor(invite.token))[0];
  await post(invite.token, { slotAt: slot });
  const firstEventId = getScheduleInviteByToken(invite.token)!.calendarEventId;

  assert.equal((await post(invite.token, { rsvp: "cancel" })).status, 200);
  assert.equal(deletes().length, 1);
  assert.equal(getScheduleInviteByToken(invite.token)!.calendarEventId, null);

  const again = (await slotsFor(invite.token))[0];
  assert.equal((await post(invite.token, { slotAt: again })).status, 200);
  assert.equal(writes().length, 2, "a re-booking writes a fresh event rather than patching a deleted one");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "written");
  assert.notEqual(stored.calendarEventId, firstEventId);
});

test("NO calendar connected ⇒ link-only behaviour, verbatim — and the invite says why", async () => {
  const invite = inviteFixture();
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  stubGoogle("ok");
  const slot = (await slotsFor(invite.token))[0];

  const res = await post(invite.token, { slotAt: slot });
  assert.equal(res.status, 200, "booking is unchanged from before this integration existed");
  assert.equal(eventCalls.length, 0, "nothing is written anywhere");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.status, "confirmed");
  assert.equal(stored.calendarEventState, "not_connected", "not 'failed' — there was nothing to write to");
  assert.equal(stored.calendarEventId, null);
});

test("the event is written to the INVITE'S OWN workspace connection, never another team's", async () => {
  const invite = inviteFixture();
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  connectCalendar("some-other-team");
  stubGoogle("ok");
  const slot = (await slotsFor(invite.token))[0];

  assert.equal((await post(invite.token, { slotAt: slot })).status, 200);
  assert.equal(eventCalls.length, 0, "another team's calendar is not this invite's calendar");
  assert.equal(getScheduleInviteByToken(invite.token)!.calendarEventState, "not_connected");
  deleteCalendarConnection("some-other-team");
});

test("a calendar failure never blocks or half-commits the booking — it is recorded", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("down");
  const slot = (await slotsFor(invite.token))[0];

  const res = await post(invite.token, { slotAt: slot });
  assert.equal(res.status, 200, "the booking is the source of truth; the event is best-effort");
  assert.ok(writes().length > 0, "the failing write path was genuinely exercised");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.status, "confirmed", "the slot is booked");
  assert.equal(stored.slotAt, slot);
  assert.equal(stored.calendarEventState, "failed", "recorded honestly, not swallowed");
  assert.equal(stored.calendarEventId, null);
});

test("a delete that does not land is recorded as ORPHANED, keeping the handle for a retry", async () => {
  const invite = inviteFixture();
  connectCalendar();
  stubGoogle("delgone");
  const slot = (await slotsFor(invite.token))[0];
  await post(invite.token, { slotAt: slot });
  const eventId = getScheduleInviteByToken(invite.token)!.calendarEventId;
  assert.ok(eventId);

  const res = await post(invite.token, { withdraw: true });
  assert.equal(res.status, 200, "a stuck delete must not fail the candidate's withdrawal");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.status, "declined");
  assert.equal(stored.calendarEventState, "orphaned", "a stale entry is still on someone's calendar — say so");
  assert.equal(stored.calendarEventId, eventId, "the handle survives so a later attempt can still find it");
});
