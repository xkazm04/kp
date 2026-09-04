// The slot proposer had no test of its own: `free-busy.ts`'s maths was pinned and
// `google-calendar.ts`'s degradation was pinned, but the module that JOINS them — the one
// that decides what a candidate is actually offered and what kp claims about it — was
// covered only incidentally. Two properties live here and nowhere else:
//
//   1. OVERFETCH. `proposeFreeSlots` asks `proposeSlots` for `count * 4` candidates so a
//      busy week still yields a full list, and reports `droppedFromOffer` rather than the
//      raw filter count — "6 times hidden as busy" beside a complete six-slot list is a
//      claim about a list the calendar never shortened.
//   2. THE THREE-VALUED RE-CHECK. `slotStillFree` returns true / false / null, and the
//      null is the important one: an outage MUST let the booking through. A guard that
//      failed closed would turn a Google incident into "nobody can book an interview".
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "available-slots-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { proposeFreeSlots, slotStillFree } = await import("./available-slots.ts");
const { proposeSlots } = await import("../schedule-slots.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");
const { DEFAULT_INTERVIEW_MINUTES } = await import("./constants.ts");

after(() => cleanupUnitDb());

const COUNT = 6;

function connectCalendar(): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
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

const realFetch = globalThis.fetch;

/** Answer free/busy with exactly these intervals. `null` = the request never lands (an
 *  outage), which is the "we do not know" the whole degradation contract turns on. */
function stubBusy(intervals: { start: string; end: string }[] | null): void {
  globalThis.fetch = (async () => {
    if (intervals === null) return new Response("upstream is down", { status: 500 });
    return new Response(JSON.stringify({ calendars: { primary: { busy: intervals } } }), { status: 200 });
  }) as typeof globalThis.fetch;
}

/** The busy interval covering exactly one proposed slot. */
const cover = (iso: string) => ({
  start: iso,
  end: new Date(Date.parse(iso) + DEFAULT_INTERVIEW_MINUTES * 60_000).toISOString(),
});

afterEach(() => {
  globalThis.fetch = realFetch;
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("a busy morning still yields a FULL list — the proposer over-fetches", () => {
  connectCalendar();
  // The pool the proposer will filter, computed the same way it does (count * OVERFETCH).
  const pool = proposeSlots([], COUNT * 4);
  assert.ok(pool.length > COUNT * 2, "the over-fetched pool is materially larger than the offer");
  stubBusy(pool.slice(0, COUNT).map((s) => cover(s.value)));

  return proposeFreeSlots([], DEFAULT_WORKSPACE_ID, COUNT).then((proposed) => {
    assert.equal(proposed.slots.length, COUNT, "six clashes cost the candidate nothing — the pool absorbed them");
    assert.equal(proposed.calendarStatus, "checked");
    assert.equal(proposed.calendarChecked, true);
    // NOT 6: `droppedFromOffer` counts what the OFFER lost, and the offer lost nothing.
    assert.equal(proposed.droppedForConflict, 0, "a drop the caller never felt is not reported as a drop");
    for (const busy of pool.slice(0, COUNT)) {
      assert.equal(
        proposed.slots.some((s) => s.value === busy.value),
        false,
        "and no offered slot is one the calendar said was busy"
      );
    }
  });
});

test("when the calendar empties the horizon, the shortfall IS reported", async () => {
  connectCalendar();
  const pool = proposeSlots([], COUNT * 4);
  // Everything but two: now the offer really is shorter, and saying so is what stops a
  // recruiter reading a two-slot list as a broken feature.
  stubBusy(pool.slice(0, pool.length - 2).map((s) => cover(s.value)));
  const proposed = await proposeFreeSlots([], DEFAULT_WORKSPACE_ID, COUNT);
  assert.equal(proposed.slots.length, 2);
  assert.equal(proposed.droppedForConflict, COUNT - 2, "the four the candidate would otherwise have seen");
  assert.equal(proposed.calendarStatus, "checked");
});

test("an outage degrades to the pre-integration list, and says 'unavailable'", async () => {
  connectCalendar();
  stubBusy(null);
  const proposed = await proposeFreeSlots([], DEFAULT_WORKSPACE_ID, COUNT);
  assert.equal(proposed.slots.length, COUNT, "scheduling worked before this integration and keeps working");
  assert.equal(proposed.calendarChecked, false, "nothing was checked, so nothing claims it was");
  assert.equal(proposed.calendarStatus, "unavailable", "a grant we hold but could not use — not 'connect a calendar'");
  assert.equal(proposed.droppedForConflict, 0);
});

test("no connection at all reads as 'not_connected' — the state a recruiter can fix", async () => {
  globalThis.fetch = (async () => {
    throw new Error("no request may be made when nothing is connected");
  }) as typeof globalThis.fetch;
  const proposed = await proposeFreeSlots([], DEFAULT_WORKSPACE_ID, COUNT);
  assert.equal(proposed.slots.length, COUNT);
  assert.equal(proposed.calendarStatus, "not_connected");
  assert.equal(proposed.calendarChecked, false);
});

test("the confirm-time re-check is THREE-valued, and unknown lets the booking through", async () => {
  const slot = proposeSlots([], 1)[0].value;

  // Nothing connected → unknown. The caller MUST proceed: a booking may not depend on an
  // integration the workspace never set up.
  assert.equal(await slotStillFree(slot, DEFAULT_WORKSPACE_ID), null);

  connectCalendar();
  stubBusy([]);
  assert.equal(await slotStillFree(slot, DEFAULT_WORKSPACE_ID), true, "checked, free — proceed");

  // Filled on the interviewer's calendar between the suggestion and the booking: the exact
  // double-booking this integration exists to prevent, arriving through the front door.
  stubBusy([cover(slot)]);
  assert.equal(await slotStillFree(slot, DEFAULT_WORKSPACE_ID), false, "checked, busy — refuse and re-offer");

  stubBusy(null);
  assert.equal(await slotStillFree(slot, DEFAULT_WORKSPACE_ID), null, "a Google incident may never block a booking");

  // An instant that cannot be placed in time yields unknown too — offeredSlotFor owns that
  // rejection, and answering `false` here would refuse it for the wrong stated reason.
  assert.equal(await slotStillFree("not-a-date", DEFAULT_WORKSPACE_ID), null);
});
