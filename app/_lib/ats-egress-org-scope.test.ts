// F-1 (2026-10-06 security scan, §A1) — the outbound ATS webhook is ONE deployment-wide
// row with no owner, so in a deployment with more than one organization, org B's
// auto-rejected candidates — name, contact, match score — were POSTed to the endpoint
// org A configured. The screening wave made it systematic: one approved click mirrors a
// whole cohort with no human at the keyboard per candidate.
//
// The fix records the SAVER's org on the config row and refuses a dispatch whose entry
// belongs to a different org. A legacy row (NULL owner) still serves the default org, so
// the single-tenant self-host — every shipped deployment today — is unchanged.
//
// Each proof names its non-vacuity. The important one is (a): the refusal must be reached
// at the ORG check, not at the subscription gate — the gate returns BEFORE the ledger row
// is opened, so "no POST happened" is also what an unsubscribed deployment looks like.
// The row-count assert is what tells the two apart.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getAtsConfig, setAtsConfig } from "./ats-config-store.ts";
import { dispatchAtsEvent, retryDueAtsDeliveries } from "./ats-egress.ts";
import { finalizeAtsDelivery, listAtsDeliveries, recordAtsDeliveryStart } from "./ats-delivery-store.ts";
// The SLICE, not the `db.ts` barrel: one barrel importer in a hub module taxes every
// route downstream, and perf-budget.json caps how many there may be.
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOrganization, DEFAULT_ORG_ID } from "./db/organizations.ts";
import { createWorkspace } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

/** Swap global fetch and COUNT the calls: "it must never POST" is only proven by a
 *  counter that would have moved. */
async function withCountedFetch<T>(
  impl: typeof fetch,
  fn: (calls: { n: number }) => Promise<T>
): Promise<T> {
  const real = globalThis.fetch;
  const calls = { n: 0 };
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    calls.n += 1;
    return (impl as (...a: Parameters<typeof fetch>) => unknown)(...args);
  }) as unknown as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

const ACCEPTS = (async () => ({ ok: true, status: 202 })) as unknown as typeof fetch;

function latestRowFor(entryId: string) {
  return listAtsDeliveries().find((r) => r.entryId === entryId);
}

// (a) — the finding itself: org A owns the endpoint, the candidate is org B's.
test("a config owned by org A refuses an entry belonging to org B — no POST, a terminal ledger row", async () => {
  const orgA = createOrganization("Org A");
  const orgB = createOrganization("Org B");
  const teamB = createWorkspace("Team B", orgB.id);
  setAtsConfig({
    webhookUrl: "https://example.com/hook",
    events: ["candidate.rejected", "candidate.hired"],
    ownerOrgId: orgA.id,
  });
  assert.ok(
    getAtsConfig().events.includes("candidate.rejected"),
    "NON-VACUITY: the event IS subscribed, so a skipped POST cannot be the subscription gate"
  );
  const { entry } = createPipelineEntry({
    candidateId: "c-f1-cross",
    candidateLabel: "Cross Org",
    jobId: "job-f1-cross",
    jobTitle: "Role",
    workspaceId: teamB.id,
  });

  const before = listAtsDeliveries().length;
  await withCountedFetch(ACCEPTS, async (calls) => {
    await dispatchAtsEvent("candidate.rejected", entry.id, teamB.id);
    assert.equal(calls.n, 0, "another org's candidate must never reach the endpoint");
  });

  assert.equal(
    listAtsDeliveries().length,
    before + 1,
    "NON-VACUITY: a ledger row WAS opened — the dispatch reached the org check, it did not exit at the subscription gate"
  );
  const row = latestRowFor(entry.id);
  assert.equal(row?.status, "failed");
  assert.equal(row?.nextAttemptAt, null, "a cross-org destination will not become correct by waiting — terminal, not retryable");
  assert.match(row?.lastError ?? "", new RegExp(orgA.id), "the reason names the org that OWNS the endpoint");
  assert.match(row?.lastError ?? "", new RegExp(orgB.id), "and the org the entry belongs to");
  assert.doesNotMatch(row?.lastError ?? "", /Cross Org/, "ledger reasons carry ids, never candidate PII");
});

// (b) — the same org still mirrors. Without this the fix is indistinguishable from
// switching the integration off.
test("a config owned by org A delivers an entry from one of org A's own teams", async () => {
  const orgA = createOrganization("Org A deliver");
  const teamA = createWorkspace("Team A", orgA.id);
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"], ownerOrgId: orgA.id });
  const { entry } = createPipelineEntry({
    candidateId: "c-f1-same",
    candidateLabel: "Same Org",
    jobId: "job-f1-same",
    jobTitle: "Role",
    workspaceId: teamA.id,
  });

  await withCountedFetch(ACCEPTS, async (calls) => {
    await dispatchAtsEvent("candidate.hired", entry.id, teamA.id);
    assert.equal(calls.n, 1, "an in-org hire is POSTed exactly once");
  });
  assert.equal(latestRowFor(entry.id)?.status, "delivered");
});

// (c) — the upgrade path. Every existing install has a config row written before the
// column existed; it must keep mirroring its own (default-org) candidates.
test("a LEGACY config with no owner still delivers the default org's entries", async () => {
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"] });
  assert.equal(getAtsConfig().ownerOrgId, null, "NON-VACUITY: this really is the unowned (legacy-shaped) row");
  const { entry } = createPipelineEntry({
    candidateId: "c-f1-legacy",
    candidateLabel: "Legacy Default",
    jobId: "job-f1-legacy",
    jobTitle: "Role",
  });

  await withCountedFetch(ACCEPTS, async (calls) => {
    await dispatchAtsEvent("candidate.hired", entry.id);
    assert.equal(calls.n, 1, "a NULL owner is the default org — the single-tenant self-host is unchanged");
  });
  assert.equal(latestRowFor(entry.id)?.status, "delivered");
  assert.equal(
    DEFAULT_ORG_ID,
    "org-default",
    "NON-VACUITY: the default-org constant the NULL owner folds to is the one the seeded org uses"
  );
});

// (d) — the retry ladder is a second door onto the same endpoint. A config RE-POINTED to
// another org between attempt 1 and the sweep must refuse there too.
test("the retry sweep refuses a row whose config has since been re-pointed to another org", async () => {
  const orgC = createOrganization("Org C");
  const teamC = createWorkspace("Team C", orgC.id);
  const orgD = createOrganization("Org D");
  setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.rejected"], ownerOrgId: orgC.id });
  const { entry } = createPipelineEntry({
    candidateId: "c-f1-retry",
    candidateLabel: "Retry Cross",
    jobId: "job-f1-retry",
    jobTitle: "Role",
    workspaceId: teamC.id,
  });
  const id = recordAtsDeliveryStart("candidate.rejected", entry.id);
  // Backdate the failure so the backoff window has elapsed and the row is due now.
  finalizeAtsDelivery(id, { delivered: false, reason: "transient" }, new Date(Date.now() - 3600_000));

  // The operator re-points the integration at a different organization's endpoint.
  setAtsConfig({ ownerOrgId: orgD.id, expectedVersion: getAtsConfig().version });
  assert.equal(getAtsConfig().ownerOrgId, orgD.id, "NON-VACUITY: the re-save really moved the owner");

  await withCountedFetch(ACCEPTS, async (calls) => {
    const out = await retryDueAtsDeliveries();
    assert.ok(out.due >= 1, "NON-VACUITY: the row really was due — the sweep had work to skip");
    assert.equal(calls.n, 0, "a re-pointed config must not deliver the previous org's candidate on a retry");
  });
  const row = listAtsDeliveries().find((r) => r.id === id);
  assert.equal(row?.status, "failed");
  assert.equal(row?.nextAttemptAt, null, "terminal — the ladder stops rather than re-offering the data each tick");
  assert.match(row?.lastError ?? "", new RegExp(orgD.id), "the reason names the owning org");
  assert.match(row?.lastError ?? "", new RegExp(orgC.id), "and the entry's own org");
});

// (e) — the write side. The column is only a boundary if it is actually recorded, and a
// re-save adopts the saver's org (that is how an install hands the integration over).
test("setAtsConfig records the writer's org, and a re-save adopts the new writer's", () => {
  const org1 = createOrganization("Writer One");
  const org2 = createOrganization("Writer Two");
  const first = setAtsConfig({ webhookUrl: "https://example.com/hook", events: ["candidate.hired"], ownerOrgId: org1.id });
  assert.equal(first.ownerOrgId, org1.id, "the returned public view carries the owner (it is an id, not a secret)");
  assert.equal(getAtsConfig().ownerOrgId, org1.id, "and it is persisted, not just echoed");

  const second = setAtsConfig({ ownerOrgId: org2.id, expectedVersion: first.version });
  assert.equal(second.ownerOrgId, org2.id, "a re-save adopts the saver's org");
  assert.equal(getAtsConfig().webhookUrl, "https://example.com/hook", "and the partial-update contract still keeps the omitted fields");
});
