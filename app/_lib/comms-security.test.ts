// Security scan 2026-10-18 — the comms boundaries that landed with channels C1: the
// shared egress seal (egress-seal.ts) and the one-message-identity receipt path.
// Each test pins one fix; the finding it closes is named above it.
//
// unit-db.ts MUST be the first project import.
import "better-sqlite3";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setRelayHostLookupForTests } from "./comms.ts";
import { recordDeliveryReceipt } from "./comms-receipt.ts";
import { listOutboxFiltered, recordOutbox } from "./db/devcase.ts";
import { createPipelineEntry } from "./db/pipeline.ts";

register(new URL("./testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

function entry(label: string) {
  return createPipelineEntry({ candidateId: `cand-${label}`, candidateLabel: label, jobId: `job-${label}`, jobTitle: "Engineer" }).entry;
}

function countFetches(): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  return calls;
}

// S-1 — the resend door re-sent a relay RECEIPT row: subject "receipt", body = the
// relay's own detail text, messageId = whatever the relay echoed.
test("resend refuses a bounced receipt row: no send, no new outbox row", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const calls = countFetches();
  const e = entry("receipt-resend");
  recordOutbox({ recipient: "jana@example.cz", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: e.id, messageId: "msg-real" });
  recordDeliveryReceipt({ ref: e.id, kind: "offer", outcome: "bounce", detail: "Click https://evil.example to fix your mailbox", messageId: "msg-foreign-id" });
  const receipt = listOutboxFiltered({ ref: e.id, status: "bounced" }, e.workspaceId)[0];
  assert.ok(receipt, "the receipt row exists");
  const before = listOutboxFiltered({ ref: e.id }, e.workspaceId).length;

  const { POST } = await import("../api/comms/[id]/resend/route.ts");
  const res = await POST(new Request(`http://localhost/api/comms/${receipt.id}/resend`, { method: "POST", body: JSON.stringify({ recipient: "someone@example.com" }) }), {
    params: Promise.resolve({ id: receipt.id }),
  });
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0, `no relay call for a receipt row, saw: ${calls.join(", ")}`);
  assert.equal(listOutboxFiltered({ ref: e.id }, e.workspaceId).length, before, "no outbox row written");
});
