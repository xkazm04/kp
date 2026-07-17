// Tenancy for the offer terminal transitions (offers-onboarding #1). createOffer
// stamps the entry's workspace_id onto the offer row, but rowToOffer never mapped
// it, so respondToOffer's actOnPipelineEntry/markEntryStatus calls fell to
// DEFAULT_WORKSPACE_ID: on a non-default team, an accept said "accepted" but the
// by-id+workspace read matched nothing → no Hired transition (misdiagnosed
// offer_accept_blocked), and a decline was silently dropped. These behavioral
// tests seed a non-default-workspace entry and prove both transitions now fire.
// (testing/unit-db.ts must be the first project import.)
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { createOffer } from "./offers-store.ts";
import { respondToOffer } from "./offer-finalize.ts";

after(() => cleanupUnitDb());

const WS = "team-offers";

function seedOfferedEntry(candidateId: string) {
  const { entry } = createPipelineEntry({
    candidateId,
    candidateLabel: `Cand ${candidateId}`,
    jobId: "job-offer",
    jobTitle: "Offer Role",
    stage: "Offer",
    workspaceId: WS,
    contact: `${candidateId}@example.com`,
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: "job-offer",
    jobTitle: "Offer Role",
    currency: "USD",
    salary: 120000,
    payload: null,
  });
  return { entry, offer };
}

test("createOffer/rowToOffer carries the entry's workspace onto the offer row", () => {
  const { offer } = seedOfferedEntry("off-ws");
  assert.equal(offer.workspaceId, WS, "the offer inherits its entry's workspace");
});

test("an accept on a non-default-workspace offer advances the entry to Hired", async () => {
  const { entry, offer } = seedOfferedEntry("off-accept");
  const res = await respondToOffer(offer.token, "accept");
  assert.equal(res.ok, true, "the accept is claimed");
  // Pre-fix: actOnPipelineEntry ran against the default workspace, found no row, and
  // the entry never advanced. Post-fix it advances Offer → Hired in WS.
  assert.equal(getPipelineEntry(entry.id, WS)!.stage, "Hired", "the entry actually transitioned to Hired");
});

test("a decline on a non-default-workspace offer closes the entry", async () => {
  const { entry, offer } = seedOfferedEntry("off-decline");
  const res = await respondToOffer(offer.token, "decline");
  assert.equal(res.ok, true, "the decline is recorded");
  assert.equal(getPipelineEntry(entry.id, WS)!.status, "declined", "the entry status actually flipped to declined");
});
