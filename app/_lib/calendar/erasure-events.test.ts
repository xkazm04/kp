// An erasure removes the interviewer's calendar event (ADR 0021 amendment, 2026-10-08).
//
// anonymizeEntry is synchronous and keeps the invite's calendar_event_id; this module
// deletes the event after the commit and a sweep retries what did not land. Google is
// stubbed at globalThis.fetch; the store, the encrypted connection and the scrub are real.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "erasure-events-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { removeErasedEntryEvents, sweepErasedInterviewEvents, ERASURE_EVENT_RETRY_SPACING_MS } = await import("./erasure-events.ts");
const { removeInterviewEvent } = await import("./event-sync.ts");
const { anonymizeEntry, createPipelineEntry, ensureErasureToken } = await import("../db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, recordCalendarEvent, listScheduleInvitesForEntry } = await import("../schedule-store.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID, createWorkspace } = await import("../db/workspaces.ts");
const { POST } = await import("../../api/data/[token]/route.ts");

after(() => cleanupUnitDb());

function connectCalendar(workspaceId: string, accessToken = "test-access-token"): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken,
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

type Call = { method: string; url: string; auth: string };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Script the DELETE responses in order (the last repeats). "throw" = transport failure. */
function scriptDelete(statuses: (number | "throw")[]): void {
  calls = [];
  let n = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), url: String(url), auth: headers.authorization ?? "" });
    const next = statuses[Math.min(n, statuses.length - 1)];
    n += 1;
    if (next === "throw") throw new Error("network down");
    return new Response(null, { status: next });
  }) as typeof globalThis.fetch;
}

const workspaces: string[] = [DEFAULT_WORKSPACE_ID];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const ws of workspaces) deleteCalendarConnection(ws);
});

let seq = 0;
/** An entry with ONE invite that holds an event id. */
function fixture(opts: { workspaceId?: string; eventId?: string | null } = {}) {
  seq += 1;
  const workspaceId = opts.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const { entry } = createPipelineEntry({
    candidateId: `ee-c${seq}`,
    candidateLabel: `Erasure Event ${seq}`,
    jobId: `ee-job-${seq}`,
    jobTitle: "Erasure Event Role",
    contact: `ee-c${seq}@example.com`,
    workspaceId,
  });
  const invite = createScheduleInvite({ entryId: entry.id, candidateLabel: entry.candidateLabel, jobTitle: "Erasure Event Role" });
  const slotAt = new Date(Date.now() + (seq + 1) * 86_400_000).toISOString();
  assert.equal(confirmScheduleInvite(invite.token, slotAt, slotAt).ok, true);
  const eventId = opts.eventId === undefined ? `evt-${seq}` : opts.eventId;
  if (eventId) recordCalendarEvent(invite.token, { state: "written", eventId });
  return { entryId: entry.id, workspaceId, eventId, token: invite.token };
}

const inviteOf = (f: { entryId: string; workspaceId: string }) => listScheduleInvitesForEntry(f.entryId, f.workspaceId)[0];
const farFuture = () => new Date(Date.now() + 10 * ERASURE_EVENT_RETRY_SPACING_MS);

test("erasing an entry deletes exactly its event, silently (sendUpdates=none), and clears the id", async () => {
  connectCalendar(DEFAULT_WORKSPACE_ID);
  const f = fixture();
  assert.ok(anonymizeEntry(f.entryId, "erasure", f.workspaceId));
  assert.equal(inviteOf(f).calendarEventId, f.eventId, "the scrub itself leaves the event alone");
  scriptDelete([204]);

  assert.deepEqual(await removeErasedEntryEvents(f.entryId, f.workspaceId), { removed: 1, orphaned: 0, skipped: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "DELETE");
  assert.ok(calls[0].url.includes(`/events/${f.eventId}?`), calls[0].url);
  assert.ok(calls[0].url.endsWith("sendUpdates=none"), "an erased person gets no cancellation mail");
  const stored = inviteOf(f);
  assert.equal(stored.calendarEventState, "removed");
  assert.equal(stored.calendarEventId, null);
});

test("a failed delete is 'orphaned' with the id kept; the sweep waits out the spacing, then lands it", async () => {
  connectCalendar(DEFAULT_WORKSPACE_ID);
  const f = fixture();
  anonymizeEntry(f.entryId, "erasure", f.workspaceId);
  scriptDelete([500]);
  assert.deepEqual(await removeErasedEntryEvents(f.entryId, f.workspaceId), { removed: 0, orphaned: 1, skipped: 0 });
  assert.equal(inviteOf(f).calendarEventState, "orphaned");
  assert.equal(inviteOf(f).calendarEventId, f.eventId);

  scriptDelete([500]);
  await sweepErasedInterviewEvents(new Date());
  assert.equal(calls.length, 0, "inside the spacing nothing is sent, so an outage is not hammered");

  scriptDelete([204]);
  await sweepErasedInterviewEvents(new Date(Date.now() + ERASURE_EVENT_RETRY_SPACING_MS + 60_000));
  assert.equal(calls.filter((c) => c.url.includes(`/events/${f.eventId}`)).length, 1);
  assert.equal(inviteOf(f).calendarEventState, "removed");
  assert.equal(inviteOf(f).calendarEventId, null);
});

test("an invite with no event id, and an entry that is NOT erased, are never touched", async () => {
  connectCalendar(DEFAULT_WORKSPACE_ID);
  const noEvent = fixture({ eventId: null });
  anonymizeEntry(noEvent.entryId, "erasure", noEvent.workspaceId);
  const live = fixture();
  // A cancel that failed leaves 'orphaned' on a live entry: not this sweep's job.
  recordCalendarEvent(live.token, { state: "orphaned" });
  scriptDelete([204]);

  await removeErasedEntryEvents(noEvent.entryId, noEvent.workspaceId);
  await sweepErasedInterviewEvents(farFuture(), 100);
  assert.equal(calls.some((c) => c.url.includes(`/events/${live.eventId}`)), false);
  assert.equal(inviteOf(live).calendarEventId, live.eventId);
  assert.equal(inviteOf(live).calendarEventState, "orphaned");
  assert.equal(inviteOf(noEvent).calendarEventState, null);
});

test("an entry anonymized through the consent-expiry door is swept", async () => {
  connectCalendar(DEFAULT_WORKSPACE_ID);
  const f = fixture();
  anonymizeEntry(f.entryId, "expiry", f.workspaceId);
  scriptDelete([204]);
  await sweepErasedInterviewEvents(farFuture(), 100);
  assert.equal(calls.filter((c) => c.url.includes(`/events/${f.eventId}`)).length, 1);
  assert.equal(inviteOf(f).calendarEventState, "removed");
});

test("an invite in a second workspace is deleted through THAT workspace's connection", async () => {
  const other = createWorkspace("Erasure Events Other").id;
  workspaces.push(other);
  connectCalendar(DEFAULT_WORKSPACE_ID, "token-default");
  connectCalendar(other, "token-other");
  const f = fixture({ workspaceId: other });
  anonymizeEntry(f.entryId, "expiry", f.workspaceId);
  scriptDelete([204]);
  await sweepErasedInterviewEvents(farFuture(), 100);
  const mine = calls.filter((c) => c.url.includes(`/events/${f.eventId}`));
  assert.equal(mine.length, 1);
  assert.equal(mine[0].auth, "Bearer token-other");
  assert.equal(inviteOf(f).calendarEventState, "removed");
});

for (const [label, script] of [
  ["fails with 500", [500]],
  ["throws", ["throw"]],
] as const) {
  test(`POST /api/data/[token] still answers {erased: true} when the calendar delete ${label}`, async () => {
    connectCalendar(DEFAULT_WORKSPACE_ID);
    const f = fixture();
    const token = ensureErasureToken(f.entryId, f.workspaceId)!;
    scriptDelete([...script]);
    const res = (await POST(
      new Request(`http://localhost/api/data/${token}`, { method: "POST", headers: { "x-forwarded-for": `10.8.0.${seq}` } }) as never,
      { params: Promise.resolve({ token }) }
    )) as unknown as Response;
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { erased: true });
    assert.equal(calls.length >= 1, true, "the door did attempt the delete");
    assert.equal(inviteOf(f).calendarEventState, "orphaned");
  });
}

test("the cancel/withdraw delete request is unchanged: no sendUpdates", async () => {
  connectCalendar(DEFAULT_WORKSPACE_ID);
  const f = fixture();
  scriptDelete([204]);
  assert.equal(await removeInterviewEvent(inviteOf(f)), "removed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.includes("sendUpdates"), false);
});
