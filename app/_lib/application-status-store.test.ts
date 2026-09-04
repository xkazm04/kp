// The store behind /status/<token> — the candidate's only public handle on their
// own application — had no behavioural test. `application-status-tenancy.test.ts`
// is a SOURCE grep (it reads the file and checks the SQL binds workspace_id), so
// nothing had ever executed a mint, a re-mint or a resolve.
//
// The invariants that matter here are all about the token being ONE per entry and
// unguessable-in, unguessable-out: a re-apply reuses the original entry, so a
// second mint must return the SAME token rather than accreting a second row (that
// is what the UNIQUE entry_id and the IMMEDIATE transaction are for), and an
// unknown token must resolve to nothing rather than to somebody.
//
// unit-db.ts must stay the first project import; the data layer is imported as a
// SLICE (db/pipeline.ts), never through app/_lib/db.ts.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import Database from "better-sqlite3";
import { openStore } from "./db-path.ts";
import { getEntryIdByStatusToken, getOrCreateStatusLink } from "./application-status-store.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const raw: Database.Database = openStore();
const linkRows = (entryId: string) =>
  raw.prepare(`SELECT token, workspace_id FROM application_status_links WHERE entry_id = ?`).all(entryId) as {
    token: string;
    workspace_id: string;
  }[];

function seedEntry(key: string, workspaceId = DEFAULT_WORKSPACE_ID): string {
  const { entry } = createPipelineEntry({
    candidateId: `profile-${key}`,
    candidateLabel: `Applicant ${key}`,
    archetype: "unclassified",
    roleFamily: null,
    jobId: `job-${key}`,
    jobTitle: "Backend Engineer",
    stage: "Accepted",
    sourceChannel: "apply",
    workspaceId,
  });
  return entry.id;
}

test("the first ask mints; every later ask returns the SAME token, and only one row exists", () => {
  const entryId = seedEntry("once");
  const first = getOrCreateStatusLink(entryId);
  assert.match(first, /^as/, "the token is the store's CSPRNG handle, not the entry id");
  assert.notEqual(first, entryId, "the entry's PK must never be the public handle");

  // A re-apply reuses the ORIGINAL entry, so the candidate must keep tracking on
  // the link they already have.
  assert.equal(getOrCreateStatusLink(entryId), first);
  assert.equal(getOrCreateStatusLink(entryId), first);
  assert.equal(linkRows(entryId).length, 1, "a re-ask must not accrete a second link row");
});

test("two mints that INTERLEAVE still collapse to one token", () => {
  // better-sqlite3 is synchronous, so the real race this guards is two PROCESSES
  // (or a re-entrant caller) both finding no row and both inserting. The design has
  // two defences and this drives the second one directly: the UNIQUE entry_id
  // constraint, which is what makes the IMMEDIATE transaction's read-then-write
  // safe even if a writer slipped between them.
  const entryId = seedEntry("race");
  const mine = getOrCreateStatusLink(entryId);
  assert.throws(
    () =>
      raw
        .prepare(`INSERT INTO application_status_links (token, entry_id, created_at, workspace_id) VALUES (?, ?, ?, ?)`)
        .run("as-second-token", entryId, new Date().toISOString(), DEFAULT_WORKSPACE_ID),
    /UNIQUE/,
    "a second link for the same entry must be impossible at the schema level"
  );
  assert.equal(getOrCreateStatusLink(entryId), mine, "the existing token still wins after the losing insert");
  assert.equal(linkRows(entryId).length, 1);
});

test("a token resolves to its entry; anything else resolves to nothing", () => {
  const entryId = seedEntry("resolve");
  const token = getOrCreateStatusLink(entryId);
  assert.equal(getEntryIdByStatusToken(token), entryId);
  // A guessed, truncated or swept token is not an error and not somebody else's
  // application — it is simply nothing. Enumeration is the whole threat this store
  // exists to prevent.
  assert.equal(getEntryIdByStatusToken("as-not-a-real-token"), null);
  assert.equal(getEntryIdByStatusToken(""), null);
  assert.equal(getEntryIdByStatusToken(entryId), null, "the entry id is not a status token");
});

test("the link inherits the tenant of the entry it points at", () => {
  const entryId = seedEntry("tenant", "team-status");
  getOrCreateStatusLink(entryId);
  assert.equal(linkRows(entryId)[0]?.workspace_id, "team-status");
});

test("distinct entries get distinct tokens", () => {
  const a = getOrCreateStatusLink(seedEntry("distinct-a"));
  const b = getOrCreateStatusLink(seedEntry("distinct-b"));
  assert.notEqual(a, b);
});
