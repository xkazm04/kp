// WHERE a delivery receipt is filed, and in what language its ledger row is written
// (lot CM, wave 37).
//
// Both doors that apply a receipt — the live relay callback and the edge drain —
// authenticate WITHOUT a tenant: COMMS_CALLBACK_SECRET is one process-wide env secret
// and the relay config is a single global row, so there is no "the workspace this
// callback authenticated for". The `ref` is the only tenant signal a receipt carries,
// and a ref that names nothing used to be filed into the DEFAULT team's Comms Center —
// an integrator's fault surfacing in one arbitrary tenant's centre.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { recordDeliveryReceipt } from "./comms-receipt.ts";
import { RECEIPT_RECIPIENT_CODE, RECEIPT_SUBJECT_CODE } from "./comms-view.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { listOutboxFiltered, recordOutbox } from "./db/devcase.ts";
import { createWorkspace, DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const other = createWorkspace("Second team");

test("a receipt for an entry in another team is filed in THAT team, never the default", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-ws2",
    candidateLabel: "Jana",
    jobId: "job-ws2",
    jobTitle: "Backend Engineer",
    workspaceId: other.id,
  });
  recordOutbox({
    recipient: "Jana",
    subject: "Offer",
    body: "…",
    kind: "offer",
    channel: "webhook",
    status: "sent",
    ref: entry.id,
  });
  const applied = recordDeliveryReceipt({ ref: entry.id, kind: "offer", outcome: "bounce" });
  assert.deepEqual(applied, { recorded: true, outcome: "bounce" });

  const mine = listOutboxFiltered({ ref: entry.id }, other.id);
  assert.equal(mine.filter((m) => m.status === "bounced").length, 1, "the receipt lands in the entry's own team");
  assert.equal(listOutboxFiltered({ ref: entry.id }, DEFAULT_WORKSPACE_ID).length, 0, "and nowhere else");
});

test("the receipt row stores CODES, not English prose", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-codes",
    candidateLabel: "Petr",
    jobId: "job-codes",
    jobTitle: "SRE",
    workspaceId: other.id,
  });
  recordOutbox({ recipient: "Petr", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: entry.id });
  recordDeliveryReceipt({ ref: entry.id, kind: "offer", outcome: "complaint" });
  const receipt = listOutboxFiltered({ ref: entry.id }, other.id).find((m) => m.status === "bounced");
  assert.ok(receipt, "the receipt was stored");
  assert.equal(receipt.subject, RECEIPT_SUBJECT_CODE);
  assert.equal(receipt.recipient, RECEIPT_RECIPIENT_CODE);
  // The relay's own address, when it gives one, is still preserved verbatim.
  recordDeliveryReceipt({ ref: entry.id, kind: "offer", outcome: "bounce", recipient: "petr@example.com" });
  const withAddress = listOutboxFiltered({ ref: entry.id }, other.id).find((m) => m.recipient === "petr@example.com");
  assert.ok(withAddress, "a reported recipient is not replaced by the code");
});

test("a receipt whose ref names nothing is refused, and filed into NO tenant", () => {
  const applied = recordDeliveryReceipt({ ref: "not-a-thing-here", kind: "offer", outcome: "bounce" });
  assert.deepEqual(applied, { recorded: false, outcome: "bounce", reason: "unknown_ref", stored: false });
  for (const ws of [DEFAULT_WORKSPACE_ID, other.id]) {
    assert.equal(listOutboxFiltered({ ref: "not-a-thing-here" }, ws).length, 0, `nothing written to ${ws}`);
  }
});

test("a known ref with no matching SEND is still stored — in its own team — and reported", () => {
  const { entry } = createPipelineEntry({
    candidateId: "cand-nosend",
    candidateLabel: "Lena",
    jobId: "job-nosend",
    jobTitle: "Analyst",
    workspaceId: other.id,
  });
  const applied = recordDeliveryReceipt({ ref: entry.id, kind: "offer", outcome: "bounce" });
  assert.deepEqual(applied, { recorded: false, outcome: "bounce", reason: "no_matching_send", stored: true });
  assert.equal(listOutboxFiltered({ ref: entry.id }, other.id).length, 1);
  assert.equal(listOutboxFiltered({ ref: entry.id }, DEFAULT_WORKSPACE_ID).length, 0);
});

test("a non-bounce outcome is accepted and writes nothing", () => {
  const applied = recordDeliveryReceipt({ ref: "whatever", kind: "offer", outcome: "delivered" });
  assert.deepEqual(applied, { recorded: false, outcome: "delivered", reason: "not_a_bounce" });
});
