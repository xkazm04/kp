// F-2 (2026-10-06 security scan) — the outbound COMMS relay is ONE deployment-wide row
// (`comms_relay_config`, id = 1) with no owner, so in a deployment with more than one
// organization every candidate-facing message org B sends — recipient, subject, the full
// letter body, the enriched kp.comm.v1 envelope naming the candidate and the role — was
// POSTed to the endpoint org A saved. It is the same finding F-1 closed for `ats_config`
// (17c2bbe9d), on a hotter path: the ATS mirror carries an outcome record, this carries
// the letter itself.
//
// The fix records the SAVER's org on the config row and REFUSES a send whose message
// belongs to a different org — no fetch, a `failed` outbox row whose detail names both
// org ids, and the dead-letter alert, so a refusal is operator-visible rather than a
// silent drop. A legacy row (NULL owner) still serves the default org, so the
// single-tenant self-host — every shipped deployment today — is unchanged.
//
// The env relay (COMMS_WEBHOOK_URL) is deliberately NOT org-checked: it is host-level
// configuration an operator put in the process environment, not something one org saved
// through the UI, and (d) pins that it stays that way.
//
// Each proof names its non-vacuity. The load-bearing one is (a): "no POST happened" is
// also what an unconfigured relay looks like, so the control is (b) — the SAME shape
// delivering once when the orgs match.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH).
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getRelayConfig, setRelayConfig } from "./comms-relay-store.ts";
import { sendComm, setRelayHostLookupForTests } from "./comms.ts";
// The SLICE, not the `db.ts` barrel: one barrel importer in a hub module taxes every
// route downstream, and perf-budget.json caps how many there may be.
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOrganization, DEFAULT_ORG_ID } from "./db/organizations.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { NextRequest } from "next/server";
import { POST as relayPOST } from "../api/comms/relay/route.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

/** A resolver answering with one ordinary public address: delivery RESOLVES the relay
 *  host before it posts, and `relay.example.test` is a fixture no resolver knows. */
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

const RELAY_URL = "https://relay.example.test/hook";

/** Swap global fetch and COUNT the calls: "it must never POST" is only proven by a
 *  counter that would have moved. */
function countedFetch(): { n: number } {
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    calls.n += 1;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  setRelayHostLookupForTests(PUBLIC_LOOKUP);
  return calls;
}

const LETTER = { to: "jana@example.cz", subject: "Interview invitation", body: "…", kind: "offer" };

// (a) — the finding itself: org A owns the relay, the candidate is org B's.
test("a relay owned by org A refuses a message belonging to org B — no POST, a failed row naming both orgs", async () => {
  const orgA = createOrganization("Relay Org A");
  const orgB = createOrganization("Relay Org B");
  const teamB = createWorkspace("Relay Team B", orgB.id);
  setRelayConfig({ url: RELAY_URL, ownerOrgId: orgA.id });
  assert.equal(getRelayConfig().url, RELAY_URL, "NON-VACUITY: a relay IS configured, so a skipped POST is not 'unconfigured'");

  const { entry } = createPipelineEntry({
    candidateId: "c-f2-cross",
    candidateLabel: "Cross Org Candidate",
    jobId: "job-f2-cross",
    jobTitle: "Role",
    workspaceId: teamB.id,
  });

  const calls = countedFetch();
  const row = await sendComm({ ...LETTER, ref: entry.id });

  assert.equal(calls.n, 0, "another org's candidate message must never reach the endpoint");
  assert.equal(row.status, "failed", "a refused send is a dead letter, not a benign 'queued'");
  assert.match(row.failureDetail ?? "", new RegExp(orgA.id), "the reason names the org that OWNS the relay");
  assert.match(row.failureDetail ?? "", new RegExp(orgB.id), "and the org the message belongs to");
  assert.doesNotMatch(row.failureDetail ?? "", /Cross Org Candidate|jana@example\.cz/, "reasons carry ids, never candidate data");
});

// (b) — the control. Without this the fix is indistinguishable from switching the relay off.
test("a relay owned by org A delivers a message from one of org A's own teams", async () => {
  const orgA = createOrganization("Relay Org A deliver");
  const teamA = createWorkspace("Relay Team A", orgA.id);
  setRelayConfig({ url: RELAY_URL, ownerOrgId: orgA.id });
  const { entry } = createPipelineEntry({
    candidateId: "c-f2-same",
    candidateLabel: "Same Org",
    jobId: "job-f2-same",
    jobTitle: "Role",
    workspaceId: teamA.id,
  });

  const calls = countedFetch();
  const row = await sendComm({ ...LETTER, ref: entry.id });

  assert.equal(calls.n, 1, "an in-org letter is POSTed exactly once");
  assert.equal(row.status, "sent");
});

// (c) — the upgrade path. Every existing install's row was written before the column
// existed; it must keep delivering its own (default-org) messages.
test("a LEGACY relay with no owner still delivers the default org's messages", async () => {
  setRelayConfig({ url: RELAY_URL });
  assert.equal(getRelayConfig().ownerOrgId, null, "NON-VACUITY: this really is the unowned (legacy-shaped) row");
  const { entry } = createPipelineEntry({
    candidateId: "c-f2-legacy",
    candidateLabel: "Legacy Default",
    jobId: "job-f2-legacy",
    jobTitle: "Role",
  });

  const calls = countedFetch();
  const row = await sendComm({ ...LETTER, ref: entry.id });

  assert.equal(calls.n, 1, "a NULL owner is the default org — the single-tenant self-host is unchanged");
  assert.equal(row.status, "sent");
  assert.equal(DEFAULT_ORG_ID, "org-default", "NON-VACUITY: the constant a NULL owner folds to is the seeded org's id");
});

// (d) — the env relay is HOST-level configuration, not an org's saved integration, and
// takes precedence over the stored row. It is not org-checked, on purpose.
test("an env-configured relay is not org-checked even while a differently-owned row is stored", async () => {
  const orgA = createOrganization("Relay Env Owner");
  const orgB = createOrganization("Relay Env Other");
  const teamB = createWorkspace("Relay Env Team B", orgB.id);
  setRelayConfig({ url: RELAY_URL, ownerOrgId: orgA.id });
  const { entry } = createPipelineEntry({
    candidateId: "c-f2-env",
    candidateLabel: "Env Relay",
    jobId: "job-f2-env",
    jobTitle: "Role",
    workspaceId: teamB.id,
  });

  const calls = countedFetch();
  process.env.COMMS_WEBHOOK_URL = "https://env-relay.example.test/hook";
  const row = await sendComm({ ...LETTER, ref: entry.id });

  assert.equal(calls.n, 1, "the host's own relay delivers for every org in the deployment");
  assert.equal(row.status, "sent");
});

// (e) — the write side. The column is only a boundary if the route records it from the
// SESSION, and a body that names someone else's org must not be able to set it.
test("POST /api/comms/relay stamps the session's org and ignores an ownerOrgId in the body", async () => {
  const impostor = createOrganization("Impostor Org");
  const res = await relayPOST(
    new NextRequest("http://localhost/api/comms/relay", {
      method: "POST",
      body: JSON.stringify({ url: RELAY_URL, expectedVersion: getRelayConfig().version, ownerOrgId: impostor.id }),
      headers: { "content-type": "application/json" },
    })
  );

  assert.equal(res.status, 200, "NON-VACUITY: the save was ACCEPTED — open mode has no operator gate to fail");
  // Open mode (no KP_OPERATOR_PASSWORD, no session) is the single default org by
  // definition, so that is what the route must stamp — never the body's claim.
  assert.equal(getRelayConfig().ownerOrgId, DEFAULT_ORG_ID, "the owner comes from the session, not from the request body");
  assert.notEqual(getRelayConfig().ownerOrgId, impostor.id);
});
