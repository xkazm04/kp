// DEGRADE, NEVER BLOCK — including when the AT-REST KEY changed under the stored tokens.
//
// The Google refresh/access tokens are AES-GCM ciphertext (token-store.ts → ats-secret.ts),
// so decrypting them THROWS once the key that encrypted them is gone: an operator rotating
// KP_SECRET, or setting KP_ATS_SECRET_KEY to decouple it from the session secret — which
// ats-secret.ts's own doc comment invites ("set KP_ATS_SECRET_KEY to decouple").
//
// That throw escaped the calendar edge entirely: accessTokenFor read both credentials
// OUTSIDE its try, so the exception travelled fetchBusy → proposeFreeSlots → the PUBLIC
// candidate route (which has no catch around the slot proposal) and answered 500. An
// operator's env change took the candidate's booking page down, from the one module that
// promises to degrade instead. The same throw made DELETE /api/calendar/google fail, so
// the operator could not even clear the dead connection.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the route is loaded (hooks only affect later
// resolutions — hence the dynamic imports below).
register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

// The key the tokens get encrypted WITH, and an OAuth client so googleOAuthConfig resolves
// — without the latter the integration reports "not configured" and never reads a token.
const ORIGINAL_KEY = "calendar-at-rest-test-secret";
process.env.KP_SECRET = ORIGINAL_KEY;
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { fetchBusy, isCalendarConnected } = await import("./google-calendar.ts");
const { proposeFreeSlots } = await import("./available-slots.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");
const { DELETE } = await import("../../api/calendar/google/route.ts");

after(() => cleanupUnitDb());

const WINDOW = { timeMin: "2026-03-02T08:00:00.000Z", timeMax: "2026-03-02T18:00:00.000Z" };

/** A live connection whose cached access token is still valid, so the read path would
 *  otherwise never even need to refresh — the decrypt happens either way. */
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

/** Rotate the at-rest key out from under the rows already written with ORIGINAL_KEY. */
function rotateAtRestKey(): void {
  process.env.KP_SECRET = "a-different-secret-entirely";
}

function restoreAtRestKey(): void {
  process.env.KP_SECRET = ORIGINAL_KEY;
}

/** No outbound request may be attempted in this file — an unreadable credential must be
 *  decided locally, long before the network. */
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  throw new Error(`unexpected outbound request in test: ${String(url)}`);
}) as typeof globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

test("tokens that no longer decrypt read as NO ANSWER, never as a thrown 500", async () => {
  connectCalendar();
  rotateAtRestKey();
  try {
    const busy = await fetchBusy(WINDOW, DEFAULT_WORKSPACE_ID);
    assert.equal(busy, null, "null is 'we do not know' — the caller's documented unknown");
    assert.notDeepEqual(busy, [], "and it must NOT be the empty busy list, which means 'all day is free'");
  } finally {
    restoreAtRestKey();
    deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  }
});

test("the candidate's slot proposal survives it, and says 'unavailable' rather than lying", async () => {
  connectCalendar();
  rotateAtRestKey();
  try {
    const proposed = await proposeFreeSlots([], DEFAULT_WORKSPACE_ID, 6);
    assert.ok(proposed.slots.length > 0, "the pre-integration list still reaches the candidate");
    assert.equal(proposed.calendarChecked, false, "nothing was checked, so nothing may claim it was");
    // "unavailable", not "not_connected": kp still HOLDS a grant, it just cannot read the
    // credential — and the two ask the operator for different repairs.
    assert.equal(proposed.calendarStatus, "unavailable");
    assert.equal(isCalendarConnected(DEFAULT_WORKSPACE_ID), true, "the connection row is intact");
    assert.equal(proposed.droppedForConflict, 0);
  } finally {
    restoreAtRestKey();
    deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  }
});

test("Disconnect still clears an unreadable connection — and admits it was not revoked", async () => {
  connectCalendar();
  rotateAtRestKey();
  try {
    const res = await DELETE();
    assert.equal(res.status, 200, "the operator must be able to clear a connection kp can no longer use");
    const body = (await res.json()) as { ok: boolean; revokedAtGoogle: boolean };
    assert.equal(body.ok, true, "the row is gone");
    assert.equal(body.revokedAtGoogle, false, "no green lie — the grant is still live at Google, go withdraw it");
    assert.equal(isCalendarConnected(DEFAULT_WORKSPACE_ID), false);
  } finally {
    restoreAtRestKey();
    deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
  }
});
