// recordEntryConsent is a read -> classify -> write (granted vs renewed from the
// SELECTed consent_given_at). A DEFERRED transaction takes the write lock only at the
// UPDATE, so a sibling connection's commit in the window makes the classification stale
// (or aborts with SQLITE_BUSY_SNAPSHOT, which busy_timeout never retries). It must take
// the lock at BEGIN (.immediate()). testing/unit-db.ts must stay the FIRST project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createPipelineEntry, recordEntryConsent, listConsentEvents } from "./pipeline.ts";

after(() => cleanupUnitDb());

test("first consent is 'granted', the next is 'renewed'", () => {
  const { entry } = createPipelineEntry({
    candidateId: "consent-lock-c1",
    candidateLabel: "Consent Lock",
    jobId: "consent-lock-job",
    jobTitle: "Role",
    stage: "Applied",
    contact: "consent-lock@example.com",
  });
  recordEntryConsent(entry.id, "test", 365, entry.workspaceId);
  recordEntryConsent(entry.id, "test", 365, entry.workspaceId);
  const kinds = listConsentEvents(entry.id, entry.workspaceId).map((e) => e.kind).reverse();
  assert.deepEqual(kinds.slice(-2), ["granted", "renewed"]);
});

test("recordEntryConsent runs its transaction IMMEDIATE (lock at BEGIN)", () => {
  const src = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
  const start = src.indexOf("export function recordEntryConsent(");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.match(body, /return tx\.immediate\(\)/);
  assert.doesNotMatch(body, /return tx\(\)/);
});
