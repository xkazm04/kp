// THE RECRUITER BOOK PATH ANSWERS A CODE, NEVER PROSE (/perfect 2026-09-02, schedule-ui-1).
//
// Every refusal on `POST /api/schedule {action:"book"}` used to be a bare English
// sentence with no `code`, so `useErrorMessage()` had nothing to resolve and the
// Schedule tab painted its LOAD banner's copy — "Failed to load." — over an action
// that loaded nothing. The recruiter who just lost the hour to a candidate's own
// self-booking and the one whose candidate was rejected in another tab read the same
// wrong sentence, in English, in all four locales.
//
// These drive the REAL handler. `currentWorkspace()` reads cookies(), which throws
// outside a request and falls back to the default workspace, so "the caller" here is
// always the default tenant.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// Point next/server at the test shim BEFORE the route loads (hooks only affect LATER
// resolutions — hence the dynamic imports below). A junction-linked worktree otherwise
// resolves next/server through two module identities, leaving the handler's own
// NextResponse.json undefined and every assertion here unreachable.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// A key for the at-rest encryption of the stored calendar tokens, and an OAuth client so
// googleOAuthConfig resolves — without these the integration reports "not connected" and
// no free/busy call is ever attempted (the same preamble as calendar-conflict.test.ts).
process.env.KP_SECRET = "schedule-book-refusals-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { POST } = await import("./route.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { createScheduleInvite, confirmScheduleInvite, getScheduleInviteByToken, listScheduleInvitesForEntry } =
  await import("../../_lib/schedule-store.ts");
const { proposeSlots, isoToDateSlot } = await import("../../_lib/schedule-slots.ts");
const { REFUSAL_ERRORS } = await import("../../_lib/api-response.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("../../_lib/calendar/token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

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

/** Answer every free/busy query, and count them. "outage" → a 5xx (fetchBusy reports
 *  null, i.e. UNKNOWN); "all" → the whole queried window is busy. The same double
 *  app/api/schedule/calendar-conflict.test.ts uses for the CANDIDATE side. */
let freeBusyCalls = 0;
function stubGoogle(busy: "outage" | "all" | { start: string; end: string }[]): void {
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
    // Any other outbound call is the event write-back kp does after a successful
    // booking; answer it plausibly so the success paths below exercise the real
    // handler end to end instead of dying on the double.
    return new Response(JSON.stringify({ id: "evt-test", htmlLink: "https://calendar.example.test/evt-test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

// A fixed pool of offerable instants, taken once: each test books a different one so
// the kp-side collision check never fires where the CALENDAR is the thing under test.
const SLOTS = proposeSlots([], 12);

let seq = 0;
function entryFixture(): { id: string; candidateLabel: string } {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `book-c${seq}`,
    candidateLabel: `Book Candidate ${seq}`,
    jobId: `book-job-${seq}`,
    jobTitle: "Booking Test Role",
    contact: `book-c${seq}@example.com`,
  });
  return { id: entry.id, candidateLabel: entry.candidateLabel };
}

function book(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/schedule", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${(seq % 250) + 1}` },
    }) as never
  ) as unknown as Promise<Response>;
}

async function refusal(body: unknown): Promise<{ status: number; code: string; error: string }> {
  const res = await book(body);
  const parsed = (await res.json()) as { code?: string; error?: string };
  return { status: res.status, code: parsed.code ?? "", error: parsed.error ?? "" };
}

test("booking an hour another confirmed invite already holds refuses with SCHEDULE_SLOT_TAKEN", async () => {
  // The real collision: a candidate self-books 14:00 through their token while the
  // recruiter's grid — a client-side snapshot taken on mount — still offers the cell.
  const taken = entryFixture();
  const target = SLOTS[0];
  const held = createScheduleInvite({
    entryId: taken.id,
    candidateLabel: taken.candidateLabel,
    jobTitle: "Booking Test Role",
    durationMin: 45,
  });
  const confirmed = confirmScheduleInvite(held.token, target.label, target.value);
  assert.equal(confirmed.ok, true, "the fixture booking itself must land");

  const other = entryFixture();
  const r = await refusal({ action: "book", entryId: other.id, dateSlot: isoToDateSlot(target.value) });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_SLOT_TAKEN", "the hour is spoken for, and the code says which refusal it is");
  // Nothing was written for the second candidate.
  assert.equal(getScheduleInviteByToken(held.token)!.entryId, taken.id, "the held booking is untouched");
});

test("booking a candidate who is closed out refuses with SCHEDULE_CANDIDATE_INACTIVE", async () => {
  const entry = entryFixture();
  actOnPipelineEntry(entry.id, "reject");
  const slot = SLOTS[2];
  const r = await refusal({ action: "book", entryId: entry.id, dateSlot: isoToDateSlot(slot.value) });
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_CANDIDATE_INACTIVE");
});

test("booking an unparseable grid cell refuses with SCHEDULE_SLOT_UNRESOLVED", async () => {
  const entry = entryFixture();
  const r = await refusal({ action: "book", entryId: entry.id, dateSlot: "not-a-date 99:99" });
  assert.equal(r.status, 400);
  assert.equal(r.code, "SCHEDULE_SLOT_UNRESOLVED");
});

test("booking an entry this board does not hold refuses with PIPELINE_ENTRY_NOT_FOUND", async () => {
  const slot = SLOTS[3];
  const r = await refusal({ action: "book", entryId: "no-such-entry", dateSlot: isoToDateSlot(slot.value) });
  assert.equal(r.status, 404);
  assert.equal(r.code, "PIPELINE_ENTRY_NOT_FOUND", "the board's own code, reused — not a second vocabulary");
});

test("every code the book path can answer resolves in all four catalogs", () => {
  // The half a route test alone cannot prove: a code with no `errors.<CODE>` entry
  // resolves to the caller's generic fallback, which is the exact failure this
  // direction exists to end. i18n:check pins the REGISTRY to the catalogs; this pins
  // the codes this ROUTE actually emits.
  const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const emitted = [...route.matchAll(/jsonRefusal\("([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(emitted.length >= 5, `expected the book path's refusals, found ${emitted.length}`);
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8")) as {
      errors: Record<string, string>;
    };
    for (const code of emitted) {
      assert.ok(code in REFUSAL_ERRORS, `${code} is not a declared refusal`);
      assert.equal(typeof catalog.errors[code], "string", `messages/${locale}.json is missing errors.${code}`);
    }
  }
});

// ---- Direction 2: the recruiter book path re-checks the calendar too ------------
//
// A candidate could not book an hour the interviewer's calendar shows busy; a
// recruiter could, from the other side of the same app, for the same interviewer.

test("a recruiter booking an hour the connected calendar shows BUSY is refused", async () => {
  const entry = entryFixture();
  const slot = SLOTS[4];
  connectCalendar();
  stubGoogle("all");
  const r = await refusal({ action: "book", entryId: entry.id, dateSlot: isoToDateSlot(slot.value) });
  assert.ok(freeBusyCalls > 0, "the book path actually consulted free/busy");
  assert.equal(r.status, 409);
  assert.equal(r.code, "SCHEDULE_CALENDAR_BUSY");
  assert.equal(
    listScheduleInvitesForEntry(entry.id).some((i) => i.status === "confirmed"),
    false,
    "nothing was booked"
  );
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("an UNKNOWN calendar never blocks a recruiter booking — the degradation contract", async () => {
  // Two ways to know nothing: nobody connected an account, and the lookup failed.
  // Both must book exactly as they did before this check existed — a Google incident
  // may not turn into "nobody can book an interview".
  const noCalendar = entryFixture();
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  const slotA = SLOTS[5];
  const res = await book({ action: "book", entryId: noCalendar.id, dateSlot: isoToDateSlot(slotA.value) });
  assert.equal(res.status, 200, "no calendar connected → books");

  const outage = entryFixture();
  const slotB = SLOTS[6];
  connectCalendar();
  stubGoogle("outage");
  const outageRes = await book({ action: "book", entryId: outage.id, dateSlot: isoToDateSlot(slotB.value) });
  assert.equal(outageRes.status, 200, "a failed lookup is UNKNOWN, not busy — the booking proceeds");
  assert.ok(freeBusyCalls > 0, "the outage path was genuinely exercised");
  assert.equal(
    listScheduleInvitesForEntry(outage.id).some((i) => i.status === "confirmed"),
    true
  );
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("a CLEAR connected calendar books, and re-confirming the same cell is not refused by kp's own event", async () => {
  const entry = entryFixture();
  const slot = SLOTS[7];
  connectCalendar();
  stubGoogle([]); // checked, genuinely clear
  const first = await book({ action: "book", entryId: entry.id, dateSlot: isoToDateSlot(slot.value) });
  assert.equal(first.status, 200);

  // The event kp wrote for THIS interview must not refuse a re-confirm of the same
  // cell — the check skips an entry's own confirmed instant.
  stubGoogle("all");
  const again = await book({ action: "book", entryId: entry.id, dateSlot: isoToDateSlot(slot.value) });
  assert.equal(again.status, 200, "re-confirming the same slot is idempotent, not a conflict");
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});
