// W1.1 — ATS link identity. The single property that separates an integration from a
// duplicate-generator: a re-sync must recognise an application it already imported.
//
// Non-vacuity: without this table, a connector's only options are "insert every time"
// (which duplicates the entire pipeline on every run, destroying the customer's funnel
// metrics) or "match on email" (which merges two genuinely different applications by the
// same person to two different roles).
//
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  deleteAtsLinksForEntry,
  deleteAtsLinksForProvider,
  deleteAtsLinksForProviderEverywhere,
  findAtsLink,
  linksForEntry,
  upsertAtsLink,
} from "./links-store.ts";

const OTHER_WS = "workspace-two";

beforeEach(() => {
  deleteAtsLinksForProvider("recruitee");
  deleteAtsLinksForProvider("recruitis");
  deleteAtsLinksForProvider("recruitee", OTHER_WS);
  deleteAtsLinksForProviderEverywhere("recruitee");
  deleteAtsLinksForProviderEverywhere("recruitis");
});
after(() => cleanupUnitDb());

test("a first import has no link; after recording, the same vendor id resolves", () => {
  assert.equal(findAtsLink("recruitee", "907"), null);
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-1", lastSeenStage: "1st round" });
  const link = findAtsLink("recruitee", "907");
  assert.equal(link?.entryId, "kp-1");
  assert.equal(link?.lastSeenStage, "1st round");
  assert.ok(link?.lastSyncedAt);
});

test("re-syncing the same application UPDATES rather than duplicating", () => {
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-1", lastSeenStage: "1st round" });
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-1", lastSeenStage: "Offer" });
  assert.equal(findAtsLink("recruitee", "907")?.lastSeenStage, "Offer");
  assert.equal(linksForEntry("kp-1").length, 1, "one application, one link — never a twin per sync");
});

test("a link's entry binding is PERMANENT once made", () => {
  // Re-pointing would orphan the decision history, comms trail and sealed records already
  // attached to the first entry. A connector passing a different entry id for the same
  // external id is a bug, not a re-parenting instruction — so the binding does not move.
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-1" });
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-DIFFERENT", lastSeenStage: "Hired" });
  const link = findAtsLink("recruitee", "907");
  assert.equal(link?.entryId, "kp-1", "the original entry keeps the binding");
  assert.equal(link?.lastSeenStage, "Hired", "but the sync bookkeeping still advances");
});

test("ids are only unique WITHIN a provider", () => {
  // Two ATSes numbering from 1 must not collide — the reason provider is part of the key.
  upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-a" });
  upsertAtsLink({ provider: "recruitis", externalId: "1", entryId: "kp-b" });
  assert.equal(findAtsLink("recruitee", "1")?.entryId, "kp-a");
  assert.equal(findAtsLink("recruitis", "1")?.entryId, "kp-b");
});

test("two tenants can connect the same ATS account without colliding", () => {
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-a" });
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-b" }, OTHER_WS);
  assert.equal(findAtsLink("recruitee", "907")?.entryId, "kp-a");
  assert.equal(findAtsLink("recruitee", "907", OTHER_WS)?.entryId, "kp-b");
  // And neither tenant can see the other's binding.
  assert.equal(linksForEntry("kp-b").length, 0, "the default workspace must not see the other tenant's link");
  assert.equal(linksForEntry("kp-b", OTHER_WS).length, 1);
});

test("the reverse lookup finds every vendor application behind one entry", () => {
  // What an egress push needs: where do I write this stage change back to?
  upsertAtsLink({ provider: "recruitee", externalId: "907", entryId: "kp-1" });
  upsertAtsLink({ provider: "recruitis", externalId: "abc", entryId: "kp-1" });
  const links = linksForEntry("kp-1");
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((l) => l.provider),
    ["recruitee", "recruitis"]
  );
});

test("dropping a provider's links is scoped to that provider and tenant", () => {
  upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-a" });
  upsertAtsLink({ provider: "recruitis", externalId: "2", entryId: "kp-b" });
  upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-c" }, OTHER_WS);
  assert.equal(deleteAtsLinksForProvider("recruitee"), 1);
  assert.equal(findAtsLink("recruitee", "1"), null);
  assert.equal(findAtsLink("recruitis", "2")?.entryId, "kp-b", "a sibling provider is untouched");
  assert.equal(findAtsLink("recruitee", "1", OTHER_WS)?.entryId, "kp-c", "another tenant is untouched");
});

// /perfect wave 41 (api-ats-integration). ats_connections is keyed by provider alone —
// one installation, one credential per ATS — while ats_links is per-tenant. Removing a
// connection through the workspace-scoped drop therefore left every OTHER workspace bound
// to a provider that no longer exists.
//
// NON-VACUITY: pre-fix `deleteAtsLinksForProviderEverywhere` did not exist and the route
// called the scoped drop, so the other tenant's link survived and the operator was told a
// count of 1 for what was really 2.
test("removing an installation-level connection drops its links in EVERY workspace", () => {
  upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-a" });
  upsertAtsLink({ provider: "recruitee", externalId: "9", entryId: "kp-c" }, OTHER_WS);
  upsertAtsLink({ provider: "recruitis", externalId: "2", entryId: "kp-b" });

  assert.equal(deleteAtsLinksForProviderEverywhere("recruitee"), 2, "both tenants' links, and the count says so");
  assert.equal(findAtsLink("recruitee", "1"), null);
  assert.equal(findAtsLink("recruitee", "9", OTHER_WS), null, "the other tenant is no longer bound to a dead provider");
  assert.equal(findAtsLink("recruitis", "2")?.entryId, "kp-b", "a sibling provider is still untouched");
});

// The erasure counterpart: the link is an IDENTITY join, so leaving it behind keeps a
// re-identification path open after the entry's own PII columns are scrubbed.
//
// NON-VACUITY: pre-fix there was no per-entry drop at all — grep `ats_links` in
// db/pipeline.ts returned nothing, so anonymizeEntry left every row in place.
test("dropping one entry's links is scoped to that entry and tenant", () => {
  upsertAtsLink({ provider: "recruitee", externalId: "1", entryId: "kp-erased" });
  upsertAtsLink({ provider: "recruitis", externalId: "2", entryId: "kp-erased" });
  upsertAtsLink({ provider: "recruitee", externalId: "3", entryId: "kp-kept" });
  upsertAtsLink({ provider: "recruitee", externalId: "4", entryId: "kp-erased" }, OTHER_WS);

  assert.equal(deleteAtsLinksForEntry("kp-erased"), 2, "every vendor identity behind the erased entry");
  assert.equal(linksForEntry("kp-erased").length, 0);
  assert.equal(linksForEntry("kp-kept").length, 1, "a neighbour on the same board is untouched");
  assert.equal(linksForEntry("kp-erased", OTHER_WS).length, 1, "another tenant's entry of the same id is untouched");
  assert.equal(deleteAtsLinksForEntry("kp-never-linked"), 0, "an entry with no links is a no-op, not an error");
});
