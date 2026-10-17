// C3 — the calendar edge under the egress seal: free/busy, event writes and deletes make
// 0 requests to Google, and a sealed read is "unknown" (null), never "free" ([]).
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { register } from "node:module";

register(new URL("../testing/next-server-hooks.mjs", import.meta.url));

process.env.KP_SECRET = "calendar-egress-seal-test-secret";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { fetchBusy, createInterviewEvent, deleteInterviewEvent } = await import("./google-calendar.ts");
const { saveCalendarConnection, deleteCalendarConnection } = await import("./token-store.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../db/workspaces.ts");

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_NO_COMMS_EGRESS;
  deleteCalendarConnection(DEFAULT_WORKSPACE_ID);
});

test("sealed: free/busy, event create and delete make 0 Google requests; the read is unknown, not free", async () => {
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
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  process.env.KP_NO_COMMS_EGRESS = "1";

  const busy = await fetchBusy({ timeMin: "2026-03-02T08:00:00.000Z", timeMax: "2026-03-02T18:00:00.000Z" }, DEFAULT_WORKSPACE_ID);
  assert.equal(busy, null, "unknown, never [] (= all free)");
  const created = await createInterviewEvent(
    { startIso: "2026-03-02T09:00:00.000Z", endIso: "2026-03-02T09:45:00.000Z", summary: "Interview" },
    DEFAULT_WORKSPACE_ID
  );
  assert.equal(created.ok, false);
  const deleted = await deleteInterviewEvent("evt-1", DEFAULT_WORKSPACE_ID);
  assert.equal(deleted.ok, false);
  assert.equal(calls.length, 0, `no fetch under the seal, saw: ${calls.join(", ")}`);
});
