// Tenant scope — `calendar_connections`, the PROOF the manifest's own doctrine requires.
//
// `app/_lib/tenancy.ts` lists this table as verified workspace-scoped, and every other
// name on that list carries a colocated `*-tenancy.test.ts` (23 of them). This one did
// not: it was listed on the strength of a reading. That matters more here than almost
// anywhere else — the row holds an encrypted Google refresh token, a credential that does
// not expire and grants ongoing access to a real person's calendar, so a leak across
// workspaces is not "team B sees team A's data", it is team B booking on team A's
// interviewer's calendar and reading when they are busy.
//
// Behavioural, not a source grep: the claim is about what a foreign workspaceId can
// actually reach through the module's own API.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.KP_SECRET = "calendar-tenancy-test-secret";

const { deleteCalendarConnection, getCachedAccessToken, getCalendarConnection, getRefreshToken, saveCalendarConnection } =
  await import("./token-store.ts");

after(() => cleanupUnitDb());

const OURS = "ws-ours";
const THEIRS = "ws-theirs";

function connect(workspaceId: string, secret: string): void {
  saveCalendarConnection(
    {
      tokens: {
        accessToken: `${secret}-access`,
        refreshToken: `${secret}-refresh`,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/calendar.freebusy"],
      },
      accountEmail: `${workspaceId}@example.com`,
      calendarId: "primary",
      missingScopes: [],
    },
    workspaceId
  );
}

test("a foreign workspace cannot READ another team's connection or its credentials", () => {
  connect(OURS, "ours");

  // Before the other team connects anything at all: not "someone else's row", nothing.
  assert.equal(getCalendarConnection(THEIRS), null, "no row for a workspace that never connected");
  assert.equal(getRefreshToken(THEIRS), null, "and no credential — the row is not global");
  assert.equal(getCachedAccessToken(THEIRS), null);

  connect(THEIRS, "theirs");
  assert.equal(getRefreshToken(OURS), "ours-refresh");
  assert.equal(getRefreshToken(THEIRS), "theirs-refresh", "each workspace reads its OWN credential");
  assert.equal(getCalendarConnection(OURS)?.accountEmail, `${OURS}@example.com`);
  assert.equal(getCalendarConnection(THEIRS)?.accountEmail, `${THEIRS}@example.com`);
});

test("the client-safe view never carries a token, for either workspace", () => {
  const view = getCalendarConnection(OURS)!;
  assert.equal(view.connected, true);
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("ours-refresh"), false, "the refresh token must never cross the API boundary");
  assert.equal(serialized.includes("ours-access"), false);
});

test("a foreign workspace cannot DELETE another team's connection", () => {
  assert.equal(deleteCalendarConnection("ws-nobody"), false, "deleting a workspace with no row changes nothing");
  assert.equal(getCalendarConnection(OURS)?.connected, true, "and leaves every other team's grant intact");
  assert.equal(getCalendarConnection(THEIRS)?.connected, true);

  assert.equal(deleteCalendarConnection(THEIRS), true);
  assert.equal(getCalendarConnection(THEIRS), null, "their row is gone");
  assert.equal(getRefreshToken(OURS), "ours-refresh", "ours is untouched — disconnect is per workspace");
});

test("every calendar_connections statement filters workspace_id", () => {
  // The behavioural checks above prove today's call sites; this one keeps a NEW statement
  // from being added unscoped. Line endings are normalised: the checkout is CRLF while a
  // worktree may be LF.
  const src = readFileSync(fileURLToPath(new URL("./token-store.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const statements = [...src.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((sql) => /\b(from|into|update|delete\s+from)\s+calendar_connections\b/i.test(sql));
  assert.ok(statements.length >= 4, `expected the store's statements, found ${statements.length}`);
  for (const sql of statements) {
    // CREATE TABLE is the one that declares the column rather than filtering on it.
    if (/create\s+table/i.test(sql)) continue;
    assert.ok(/workspace_id/.test(sql), `a calendar_connections statement is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});
