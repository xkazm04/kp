// The write-back seam's own contract, at the unit level.
//
// `app/api/schedule/calendar-writeback.test.ts` drives this through the real candidate
// routes, which is the right test for "do the call sites exist"; it is the wrong place to
// enumerate the seam's outcomes, because reaching `orphaned` or the gone-recreate through
// a route means staging a whole lifecycle for one branch. These four are the ones that
// decide what a recruiter is told, and each is a different repair:
//
//   written   — the event exists; its id and link ride on the invite.
//   (patch)   — a reschedule PATCHES the SAME event; one interview is never two entries.
//   (gone)    — someone deleted kp's event in Google by hand: re-create, do not report a
//               failure for a thing the recruiter removed themselves.
//   orphaned  — the delete did not land, so a stale entry is still on someone's calendar.
//               The event id is KEPT, so a later retry can still find it.
//
// The Google edge is stubbed at `globalThis.fetch`; everything below it is real (the
// store, the encrypted connection, the event body composed by calendar-links.ts).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "event-sync-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { syncInterviewEvent, removeInterviewEvent } = await import("./event-sync.ts");
const { createPipelineEntry } = await import("../db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, getScheduleInviteByToken } = await import("../schedule-store.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");

after(() => cleanupUnitDb());

function connectCalendar(): void {
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
    DEFAULT_WORKSPACE_ID
  );
}

let seq = 0;
/** A CONFIRMED invite — the write-back has nothing to write before a slot exists. */
function confirmedInvite(): NonNullable<ReturnType<typeof getScheduleInviteByToken>> {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `es-c${seq}`,
    candidateLabel: `Sync Candidate ${seq}`,
    jobId: `es-job-${seq}`,
    jobTitle: "Sync Test Role",
    contact: `es-c${seq}@example.com`,
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: "Sync Test Role" });
  const slotAt = new Date(Date.now() + (seq + 1) * 86_400_000).toISOString();
  const confirmed = confirmScheduleInvite(invite.token, slotAt, slotAt);
  assert.equal(confirmed.ok, true);
  return getScheduleInviteByToken(invite.token)!;
}

type Call = { method: string; url: string };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Script Google per REQUEST METHOD, which is what distinguishes the branches here. */
function scriptGoogle(byMethod: Record<string, { status: number; body?: string }[]>): void {
  calls = [];
  const cursors: Record<string, number> = {};
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url) });
    const queue = byMethod[method] ?? [];
    const next = queue[Math.min(cursors[method] ?? 0, queue.length - 1)];
    cursors[method] = (cursors[method] ?? 0) + 1;
    if (!next) throw new Error(`unscripted ${method} to ${String(url)}`);
    // `null`, not "": a 204 may carry no body at all, and constructing one with an
    // empty string throws — which would look like a transport failure, not a success.
    return new Response(next.body ?? null, { status: next.status });
  }) as typeof globalThis.fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

const created = (id: string) => ({ status: 200, body: JSON.stringify({ id, htmlLink: `https://calendar.example/${id}` }) });

test("a first sync CREATES the event and records its id and link on the invite", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [created("evt-created")] });

  assert.equal(await syncInterviewEvent(invite), "written");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "written");
  assert.equal(stored.calendarEventId, "evt-created");
  assert.equal(stored.calendarEventLink, "https://calendar.example/evt-created");
});

test("a later sync PATCHES the same event — one interview is never two entries", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [created("evt-one")], PATCH: [created("evt-one")] });
  await syncInterviewEvent(invite);

  const rescheduled = getScheduleInviteByToken(invite.token)!;
  assert.equal(await syncInterviewEvent(rescheduled), "written");
  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST", "PATCH"],
    "the second write moves the existing event rather than leaving a ghost at the old time"
  );
  assert.ok(calls[1].url.endsWith("/evt-one"), "and it addresses exactly the event kp wrote");
  assert.equal(getScheduleInviteByToken(invite.token)!.calendarEventId, "evt-one");
});

test("an event deleted in Google by hand is RE-CREATED, not reported as a failure", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [created("evt-first"), created("evt-second")], PATCH: [{ status: 410 }] });
  await syncInterviewEvent(invite);

  const afterManualDelete = getScheduleInviteByToken(invite.token)!;
  assert.equal(await syncInterviewEvent(afterManualDelete), "written", "'gone' is a cue to re-write, not an error to show");
  assert.deepEqual(
    calls.map((c) => c.method),
    ["POST", "PATCH", "POST"]
  );
  assert.equal(getScheduleInviteByToken(invite.token)!.calendarEventId, "evt-second", "the invite now holds the NEW event");
});

test("a cancelled interview is REMOVED, and the handle is cleared", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [created("evt-doomed")], DELETE: [{ status: 204 }] });
  await syncInterviewEvent(invite);

  assert.equal(await removeInterviewEvent(getScheduleInviteByToken(invite.token)!), "removed");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "removed");
  assert.equal(stored.calendarEventId, null, "no handle means no event out there — which is what keeps this idempotent");
});

test("a delete that does not land is ORPHANED — and keeps the id for a retry", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [created("evt-stuck")], DELETE: [{ status: 500 }, { status: 500 }] });
  await syncInterviewEvent(invite);

  const state = await removeInterviewEvent(getScheduleInviteByToken(invite.token)!);
  assert.equal(state, "orphaned", "a stale entry is still sitting on someone's calendar — say so");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "orphaned");
  assert.equal(stored.calendarEventId, "evt-stuck", "the handle survives, so a later attempt can still find it");
});

test("an invite with no event has nothing to remove, and an unbooked one nothing to write", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({});
  assert.equal(await removeInterviewEvent(invite), null, "never a search-and-guess for an event kp never wrote");
  assert.equal(await syncInterviewEvent({ ...invite, slotAt: null }), null, "no booked slot ⇒ nothing to write");
  assert.deepEqual(calls, [], "and neither touched the network");
});

test("no connected calendar is NOT a failure — it is the documented link-only product", async () => {
  const invite = confirmedInvite();
  scriptGoogle({});
  assert.equal(await syncInterviewEvent(invite), "not_connected");
  assert.equal(getScheduleInviteByToken(invite.token)!.calendarEventState, "not_connected");
  assert.deepEqual(calls, []);
});

test("a connected calendar that refuses the write is recorded as failed — the booking stands", async () => {
  connectCalendar();
  const invite = confirmedInvite();
  scriptGoogle({ POST: [{ status: 403, body: "insufficient scope" }] });
  assert.equal(await syncInterviewEvent(invite), "failed");
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.calendarEventState, "failed");
  assert.equal(stored.status, "confirmed", "the interview is still booked — the booking is the source of truth");
  assert.equal(stored.calendarEventId, null);
});
