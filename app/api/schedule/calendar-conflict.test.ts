// The whole interview must be conflict-checked, and re-checked at the moment of booking.
//
// Two real double-booking defects in the W1.4 free/busy seam, pinned end-to-end through
// the REAL route with a stubbed Google edge (globalThis.fetch), because the bug was never
// in the maths — free-busy.ts has always honoured `minutes` — but in the CALL SITES, which
// omitted it. A test at the pure layer would have passed against the broken product.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
// TYPE-ONLY next/server import, deliberately. A junction-linked worktree resolves
// next/server through two module identities, so constructing a NextRequest throws
// "NextRequest is not a constructor" and takes every route test in this repo's worktrees
// with it. The handlers only use url / headers / json(), all of which a standard Request
// satisfies, so the request is built with the platform constructor and cast.
import type { NextRequest } from "next/server";

const req = (url: string, init?: RequestInit): NextRequest => new Request(url, init) as unknown as NextRequest;
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route is loaded (hooks only affect later
// resolutions — hence the dynamic imports below). Without this the handler's own
// NextResponse.json is undefined in a junction-linked worktree and nothing can be asserted.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// A key for the at-rest encryption of the stored calendar tokens, and an OAuth client so
// googleOAuthConfig resolves — without these the integration reports "not connected" and
// no free/busy call is ever attempted.
process.env.KP_SECRET = "calendar-conflict-test-secret";
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
function inviteFixture(durationMin: number | null) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `cal-c${seq}`,
    candidateLabel: `Calendar Candidate ${seq}`,
    jobId: `cal-job-${seq}`,
    jobTitle: "Calendar Test Role",
    contact: `cal-c${seq}@example.com`,
  });
  return createScheduleInvite({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobTitle: entry.jobTitle,
    durationMin,
  });
}

async function read(token: string): Promise<{ slots: { value: string }[]; calendarChecked: boolean }> {
  const res = await GET(req(`http://localhost/api/schedule/${token}`), params(token));
  assert.equal(res.status, 200);
  const body = await res.json();
  return { slots: body.slots, calendarChecked: body.calendarChecked === true };
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

/** Connect a calendar whose cached access token has not expired, so fetchBusy goes
 *  straight to the (stubbed) free/busy endpoint without a refresh hop. */
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
after(() => {
  globalThis.fetch = realFetch;
});

/** Answer every free/busy query with `busy`, and record how many were made.
 *  "outage" → a 5xx (fetchBusy reports null, i.e. UNKNOWN).
 *  "all"    → the entire queried window is busy, whatever it turns out to be. */
let freeBusyCalls = 0;
function stubGoogle(busy: { start: string; end: string }[] | "outage" | "all"): void {
  freeBusyCalls = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("freeBusy")) {
      freeBusyCalls += 1;
      if (busy === "outage") return new Response("upstream exploded", { status: 503 });
      const query = JSON.parse(String(init?.body ?? "{}")) as { timeMin: string; timeMax: string };
      const intervals = busy === "all" ? [{ start: query.timeMin, end: query.timeMax }] : busy;
      return new Response(JSON.stringify({ calendars: { primary: { busy: intervals } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected outbound request in test: ${href}`);
  }) as typeof globalThis.fetch;
}

const plus = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

before(() => {
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("a 90-minute interview is conflict-checked across its FULL span, not its first 45 minutes", async () => {
  // Baseline with no calendar connected: the pre-integration list, untouched.
  const long = inviteFixture(90);
  const short = inviteFixture(45);
  const baseline = await read(long.token);
  assert.equal(baseline.calendarChecked, false, "nothing is connected yet — never claim 'checked'");
  const target = baseline.slots[0].value;

  // A meeting sitting in MINUTES 50–60 of the interview: entirely clear of the first 45,
  // squarely inside a 90-minute booking. Checked as 45 (the pre-fix behaviour), the slot
  // survives; checked as the real 90, it must be gone.
  connectCalendar();
  stubGoogle([{ start: plus(target, 50), end: plus(target, 60) }]);

  const checked = await read(long.token);
  assert.equal(checked.calendarChecked, true, "a connected calendar answered");
  assert.ok(freeBusyCalls > 0, "the route actually consulted free/busy");
  assert.equal(
    checked.slots.some((s) => s.value === target),
    false,
    "the second half of a 90-minute interview lands on a busy block — the slot must not be offered"
  );

  // Control: the SAME busy block leaves a 45-minute interview alone, proving the removal
  // above comes from the threaded duration and not from a blanket widening.
  const shortRead = await read(short.token);
  assert.equal(
    shortRead.slots.some((s) => s.value === target),
    true,
    "a 45-minute interview ends before the busy block starts — it stays offerable"
  );
});

test("a slot that fills between suggestion and confirm is REFUSED, not double-booked", async () => {
  const invite = inviteFixture(45);
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  const offered = (await read(invite.token)).slots[0].value;

  // The interviewer's calendar fills in the gap between the page load and the click.
  connectCalendar();
  stubGoogle([{ start: offered, end: plus(offered, 60) }]);

  const res = await post(invite.token, { slotAt: offered });
  assert.equal(res.status, 409, "a booking into a known conflict must be refused");
  assert.match((await res.json()).error, /pick another/);
  assert.equal(
    getScheduleInviteByToken(invite.token)!.status,
    "pending",
    "the invite stays bookable so the candidate can be re-offered"
  );
});

test("an UNKNOWN calendar never blocks a booking — the degradation contract", async () => {
  // Two ways to know nothing: nobody connected an account, and the lookup failed. Both
  // must book exactly as they did before this integration existed. A guard that failed
  // closed would turn a Google incident into "nobody can book an interview".
  const noCalendar = inviteFixture(45);
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  const slotA = (await read(noCalendar.token)).slots[0].value;
  assert.equal((await post(noCalendar.token, { slotAt: slotA })).status, 200, "no calendar connected → books");

  const outage = inviteFixture(45);
  const slotB = (await read(outage.token)).slots.find((s) => s.value !== slotA)!.value;
  connectCalendar();
  stubGoogle("outage");
  const res = await post(outage.token, { slotAt: slotB });
  assert.equal(res.status, 200, "a failed lookup is UNKNOWN, not busy — the booking proceeds");
  assert.ok(freeBusyCalls > 0, "the outage path was genuinely exercised");
  assert.equal(getScheduleInviteByToken(outage.token)!.status, "confirmed");
});

test("a legacy invite with a null durationMin still books", async () => {
  const legacy = inviteFixture(null);
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  const slots = (await read(legacy.token)).slots;
  assert.ok(slots.length > 0, "a null duration falls back to the documented default, it does not throw");
  connectCalendar();
  stubGoogle([]); // checked, calendar genuinely clear
  const res = await post(legacy.token, { slotAt: slots[0].value });
  assert.equal(res.status, 200);
  assert.equal(getScheduleInviteByToken(legacy.token)!.status, "confirmed");
});

test("a fully-conflicted horizon still reaches the existing no-slots escalation", async () => {
  // The over-correction watch: a longer conflict window legitimately removes MORE slots,
  // which can trip the noSlots escalation more often. Verify that path still behaves —
  // zero slots, the honest flag, and no crash — rather than degrading into an empty grid.
  const invite = inviteFixture(90);
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  connectCalendar();
  stubGoogle("all");

  const res = await GET(req(`http://localhost/api/schedule/${invite.token}`), params(invite.token));
  const body = await res.json();
  assert.equal(body.slots.length, 0);
  assert.equal(body.noSlots, true, "the recruiter is flagged and the candidate gets the propose-your-own-times exit");
  assert.equal(body.calendarChecked, true, "and it is honest about WHY the list is empty");
});

test("a horizon emptied by the CALENDAR still lets the candidate propose their own times", async () => {
  // The exit the previous test proves is OFFERED must also be ACCEPTED. The POST's
  // "are you really stuck?" check used the bare proposeSlots (kp bookings only), so a
  // horizon emptied by the interviewer's calendar — exactly the state the GET above
  // renders — answered the candidate's submission with "there are still open times,
  // pick one from the list" over a picker showing none. A closed loop.
  const invite = inviteFixture(45);
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  // Grab a real offered instant BEFORE the calendar goes fully busy — proposedSlotFor
  // only accepts a future weekday working hour, and an offered slot is one by construction.
  const target = (await read(invite.token)).slots[0].value;

  connectCalendar();
  stubGoogle("all"); // nothing on the horizon survives the free/busy filter
  assert.equal((await read(invite.token)).slots.length, 0, "the picker is genuinely empty");

  const res = await post(invite.token, { propose: [target] });
  assert.equal(res.status, 200, `a stranded candidate must be able to escalate — got ${await res.clone().text()}`);
  const stored = getScheduleInviteByToken(invite.token)!;
  assert.equal(stored.proposalStatus, "pending", "the recruiter now has something to accept");
  assert.equal(stored.proposals?.[0].value, target);
});
