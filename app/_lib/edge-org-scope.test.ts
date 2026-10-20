// F-3 (2026-10-06 security scan) — the EDGE pairing belongs to the organization that
// saved it, for the two things that really cross the boundary.
//
// `edge_config` is ONE row (id = 1) and install-level BY DESIGN: one sealing keypair
// that is never rotated, one drain cursor, one edge URL. So this is NOT F-2's shape and
// must not be made into it. Drained lead/mail events are routed per event by their
// RECEIVER TOKEN (ingestInboundLeadByToken), which is a workspace capability — the
// tenancy is already carried per event, and refusing another org's leads on the one
// install edge would cut inbound for every org but one. The two real exposures are:
//
//   • THE DOORS. Any `org:manage` holder of ANY org could re-point, unpair or re-key
//     the install's pairing — i.e. redirect every org's inbound transport, or reset the
//     drain cursor and skip everything below it.
//   • RECEIPTS. A receipt drained from a UI-saved edge is addressed by `ref`, and a ref
//     naming another org's pipeline entry filed a `bounced` outbox row into THAT org's
//     ledger (comms-receipt.ts receiptWorkspace resolves the tenant from the ref alone).
//
// The env pairing (KP_EDGE_URL/KP_EDGE_SECRET) is host-level configuration an operator
// put in the process environment to serve the whole deployment, exactly like the env
// relay in F-2, and is NOT org-checked. It is told from a stored row by the resolver's
// `source`, never by a null owner — a legacy stored row also has a null owner and that
// one IS checked. (g) pins it.
//
// Each proof names its non-vacuity: "nothing was written" and "nothing happened" are
// also what an unconfigured edge looks like, so every refusal has a control beside it.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { getEdgeConfig, setEdgeConfig } from "./edge-config.ts";
import { drainEdge, setEdgeHostLookupForTests } from "./edge-drain.ts";
// The SLICE, not the `db.ts` barrel: one barrel importer in a hub module taxes every
// route downstream, and perf-budget.json caps how many there may be.
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOrganization, DEFAULT_ORG_ID } from "./db/organizations.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { createChannelWebhook } from "./db/channels.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import { NextRequest } from "next/server";
import { POST as edgePOST } from "../api/edge/route.ts";

before(() => {
  // At-rest encryption needs a master key; the store falls back to KP_SECRET.
  process.env.KP_SECRET = "unit-test-master-key";
});
after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setEdgeHostLookupForTests(undefined);
  delete process.env.KP_EDGE_URL;
  delete process.env.KP_EDGE_SECRET;
  // RELEASE THE PAIRING between proofs. `edge_config` is one install-level row, so a
  // pairing left owned by the previous test's org would refuse the next test's setup —
  // and the refusal under test would then be indistinguishable from the fixture failing.
  // Unpairing as the current owner is the only authorized way to get back to unowned,
  // which is itself the shape (d) asserts.
  setEdgeConfig({ url: "", ownerOrgId: getEdgeConfig().ownerOrgId });
});

const URL_A = "https://kp-edge-a.example.com";
const URL_B = "https://kp-edge-b.example.com";

/** A resolver answering with one ordinary public address: the drain RESOLVES the edge
 *  host before it fetches, and `example.com` fixtures are not a real pairing. */
const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];

/** Serve one page of events as the edge would, then an empty one, and accept the ack.
 *  Returns the call log so a proof can say what the drain actually did. */
function edgeServing(events: Array<Record<string, unknown>>): { paths: string[] } {
  const log: { paths: string[] } = { paths: [] };
  let served = false;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    log.paths.push(url);
    if (url.includes("/drain?")) {
      const page = served ? [] : events;
      served = true;
      return new Response(JSON.stringify({ events: page, pending: 0 }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  setEdgeHostLookupForTests(PUBLIC_LOOKUP);
  return log;
}

/** The refusal, matched by the error's NAME rather than by importing the class: this file
 *  was committed RED first, and a missing top-level import would have failed it as one
 *  module error instead of eight separate verdicts. `EdgeOwnershipError` subclasses
 *  `EdgeConfigError`, so the name is what tells the two apart at the route too. */
const isOwnershipRefusal = (e: unknown): boolean => e instanceof Error && e.name === "EdgeOwnershipError";

/** The pairing as the UI saves it: a stored row (source `config`) owned by `orgId`. */
function pairAs(orgId: string, url: string): void {
  setEdgeConfig({ url, secret: "edge-shared-secret", ownerOrgId: orgId });
}

// ---------------------------------------------------------------------------
// The DOORS. Only the owning organization may rewrite the install's pairing.
// ---------------------------------------------------------------------------

// (a) — the finding itself, at the write door.
test("a pairing saved by org A refuses another organization's save — 403, and the row is unchanged", async () => {
  const orgA = createOrganization("Edge Org A");
  pairAs(orgA.id, URL_A);
  assert.equal(getEdgeConfig().url, URL_A, "NON-VACUITY: a pairing IS stored, so a refused write is not 'nothing was configured'");

  // Open mode (no KP_OPERATOR_PASSWORD, no session) is the DEFAULT org by definition,
  // so the route's caller is `org-default` — a different organization from org A.
  const res = await edgePOST(
    new NextRequest("http://localhost/api/edge", {
      method: "POST",
      body: JSON.stringify({ url: URL_B }),
      headers: { "content-type": "application/json" },
    })
  );

  assert.equal(res.status, 403, "another org's operator may not re-point this install's transport");
  assert.equal(((await res.json()) as { code?: string }).code, "EDGE_OWNED_BY_OTHER_ORG");
  assert.equal(getEdgeConfig().url, URL_A, "the stored pairing is untouched");
  assert.equal(getEdgeConfig().ownerOrgId, orgA.id, "and so is its owner");
});

// (b) — the control. Without it the fix is indistinguishable from freezing the door.
test("the owning organization may re-save its own pairing, and keeps the owner", () => {
  const orgA = createOrganization("Edge Org A resave");
  pairAs(orgA.id, URL_A);
  const after = setEdgeConfig({ url: URL_B, ownerOrgId: orgA.id });
  assert.equal(after.url, URL_B, "the owner's own edit lands");
  assert.equal(after.ownerOrgId, orgA.id, "and the row stays theirs");
});

// (c) — the upgrade path. Every existing install's row was written before the column
// existed, and it belongs to the default org, which is the only org such an install has.
test("a LEGACY pairing with no owner is writable by the default org and refused to another", () => {
  setEdgeConfig({ url: URL_A, secret: "edge-shared-secret" });
  assert.equal(getEdgeConfig().ownerOrgId, null, "NON-VACUITY: this really is the unowned (legacy-shaped) row");

  const adopted = setEdgeConfig({ url: URL_A, ownerOrgId: DEFAULT_ORG_ID });
  assert.equal(adopted.ownerOrgId, DEFAULT_ORG_ID, "a NULL owner IS the default org — the single-tenant self-host is unchanged");
  assert.equal(DEFAULT_ORG_ID, "org-default", "NON-VACUITY: the constant a NULL owner folds to is the seeded org's id");

  const outsider = createOrganization("Edge Legacy Outsider");
  assert.throws(() => setEdgeConfig({ url: URL_B, ownerOrgId: outsider.id }), isOwnershipRefusal);
  assert.equal(getEdgeConfig().url, URL_A, "the refused write wrote nothing");
});

// (d) — unpairing RELEASES the install. Otherwise an org that leaves takes the edge
// with it and nobody can ever pair again.
test("an unpaired install is claimable: the owner is cleared, and the next organization to pair owns it", () => {
  const orgA = createOrganization("Edge Org A release");
  const orgB = createOrganization("Edge Org B claim");
  pairAs(orgA.id, URL_A);

  const unpaired = setEdgeConfig({ url: "", ownerOrgId: orgA.id });
  assert.equal(unpaired.url, null);
  assert.equal(unpaired.ownerOrgId, null, "unpairing releases the claim");

  const claimed = setEdgeConfig({ url: URL_B, secret: "edge-shared-secret", ownerOrgId: orgB.id });
  assert.equal(claimed.url, URL_B);
  assert.equal(claimed.ownerOrgId, orgB.id, "whoever pairs next owns it");
});

// (e) — the write side is only a boundary if the ROUTE records the session's org. A body
// that names someone else's org must not be able to set, or launder, the owner.
test("POST /api/edge stamps the session's org and ignores an ownerOrgId in the body", async () => {
  const impostor = createOrganization("Edge Impostor Org");
  const res = await edgePOST(
    new NextRequest("http://localhost/api/edge", {
      method: "POST",
      body: JSON.stringify({ url: URL_A, secret: "edge-shared-secret", ownerOrgId: impostor.id }),
      headers: { "content-type": "application/json" },
    })
  );

  assert.equal(res.status, 200, "NON-VACUITY: the save was ACCEPTED — open mode has no operator gate to fail");
  assert.equal(getEdgeConfig().ownerOrgId, DEFAULT_ORG_ID, "the owner comes from the session, not from the request body");
  assert.notEqual(getEdgeConfig().ownerOrgId, impostor.id);
});

// ---------------------------------------------------------------------------
// RECEIPTS. A ref-addressed effect on an org-scoped ledger, from a UI-saved edge.
// ---------------------------------------------------------------------------

function bouncedRowsFor(ref: string, workspaceId: string) {
  return listOutboxFiltered({ ref, status: "bounced", limit: 20 }, workspaceId);
}

/** Sequence numbers climb across the whole file. The drain cursor is INSTALL-level (one
 *  row, id = 1), and a `seq` at or below the stored cursor is correctly discarded as
 *  already-applied — which would make a proof pass or fail for a reason that has nothing to
 *  do with the org boundary. (The per-test unpair above resets the cursor as well, so this
 *  is belt and braces; it costs nothing and removes the coupling.) */
let nextSeq = 1;
function seq(): number {
  return nextSeq++;
}

function receiptEvent(ref: string): Record<string, unknown> {
  return { seq: seq(), kind: "receipt", body: { ref, kind: "offer", outcome: "bounced", detail: "550 mailbox unavailable" } };
}

// (f) — the finding, plus its control in the same test so "no row" cannot be the
// drain quietly doing nothing at all.
test("a drained receipt for another organization's ref is skipped and files no row; the owner's own ref files its bounced row", async () => {
  const orgA = createOrganization("Edge Receipt Owner");
  const orgB = createOrganization("Edge Receipt Other");
  const teamA = createWorkspace("Edge Receipt Team A", orgA.id);
  const teamB = createWorkspace("Edge Receipt Team B", orgB.id);
  pairAs(orgA.id, URL_A);

  const mine = createPipelineEntry({
    candidateId: "c-f3-mine",
    candidateLabel: "Owner Org Candidate",
    jobId: "job-f3-mine",
    jobTitle: "Role",
    workspaceId: teamA.id,
  }).entry;
  const theirs = createPipelineEntry({
    candidateId: "c-f3-theirs",
    candidateLabel: "Other Org Candidate",
    jobId: "job-f3-theirs",
    jobTitle: "Role",
    workspaceId: teamB.id,
  }).entry;

  edgeServing([receiptEvent(mine.id), receiptEvent(theirs.id)]);
  const summary = await drainEdge();

  assert.equal(summary.fetched, 2, "NON-VACUITY: both receipts were served and read");
  assert.equal(summary.errorKind, null, "a cross-org receipt is SKIPPED, never HELD — a hold wedges the queue forever");
  assert.equal(bouncedRowsFor(mine.id, teamA.id).length, 1, "the owner's own bounce is filed (the control)");
  assert.equal(bouncedRowsFor(theirs.id, teamB.id).length, 0, "another org's ledger is never written from this org's edge");
});

// (g) — the env pairing is HOST-level, and not org-checked. Same rule as F-2's env relay.
test("with KP_EDGE_URL + KP_EDGE_SECRET set, a receipt for another organization's ref is NOT refused", async () => {
  const orgA = createOrganization("Edge Env Owner");
  const orgB = createOrganization("Edge Env Other");
  const teamB = createWorkspace("Edge Env Team B", orgB.id);
  pairAs(orgA.id, URL_A);
  const theirs = createPipelineEntry({
    candidateId: "c-f3-env",
    candidateLabel: "Env Edge Candidate",
    jobId: "job-f3-env",
    jobTitle: "Role",
    workspaceId: teamB.id,
  }).entry;

  process.env.KP_EDGE_URL = URL_B;
  process.env.KP_EDGE_SECRET = "env-shared-secret";
  edgeServing([receiptEvent(theirs.id)]);
  await drainEdge();

  assert.equal(
    bouncedRowsFor(theirs.id, teamB.id).length,
    1,
    "the host's own edge is the whole deployment's transport, for every org in it"
  );
});

// (h) — the shape that must NOT change. Leads are routed by their own receiver token,
// which carries the tenancy; org-checking them would cut inbound for every org but one.
test("a lead event for another organization's receiver token still applies", async () => {
  const orgA = createOrganization("Edge Lead Owner");
  const orgB = createOrganization("Edge Lead Other");
  const teamB = createWorkspace("Edge Lead Team B", orgB.id);
  pairAs(orgA.id, URL_A);

  const jobId = "job-f3-lead";
  ensureDb()
    .prepare(`INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, NULL, ?, ?)`)
    .run(jobId, "Lead Engineer", JSON.stringify({ id: jobId, title: "Lead Engineer" }), teamB.id, new Date().toISOString());
  const token = createChannelWebhook({ channel: "boards", jobId, lang: "en" }, teamB.id).token;

  edgeServing([
    { seq: seq(), kind: "lead", token, body: { name: "Drained Applicant", email: "drained.applicant@example.com" } },
  ]);
  const summary = await drainEdge();

  assert.equal(summary.fetched, 1, "NON-VACUITY: the lead was served and read");
  assert.equal(summary.applied, 1, "the token IS the tenancy — the one install edge is every org's inbound transport");
  assert.equal(summary.errorKind, null);
});
