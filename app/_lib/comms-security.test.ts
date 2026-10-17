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

// S-2 — the relay probe vetted the URL by NAME only, while delivery resolves it: a name
// answering a private address took a signed POST and its HTTP status was reported back.
test("relay probe refuses a relay whose name resolves into private space: 0 fetches", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://rebind.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "169.254.169.254" }]);
  const calls = countFetches();
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../api/comms/relay/test/route.ts");
  const res = await POST(new NextRequest("http://localhost/api/comms/relay/test", { method: "POST" }));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0, `no probe to a private address, saw: ${calls.join(", ")}`);
  const body = (await res.json()) as { ok: boolean; reason?: string };
  assert.equal(body.ok, false);
  assert.match(body.reason ?? "", /non-public address/);
});

test("relay probe still pings a relay whose name resolves publicly", async () => {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const calls = countFetches();
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../api/comms/relay/test/route.ts");
  const res = await POST(new NextRequest("http://localhost/api/comms/relay/test", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(calls, ["https://relay.example.test/hook"]);
});

// S-3 — the live callback had no org boundary (the edge drain has had one since F-3): a
// relay org A saved could bounce, or stamp delivered, org B's messages by naming B's ref.
test("callback: a stored relay's receipt for ANOTHER org's ref is filed nowhere, answered as unknown_ref", async () => {
  const { createOrganization } = await import("./db/organizations.ts");
  const { createWorkspace } = await import("./db/workspaces.ts");
  const { setRelayConfig } = await import("./comms-relay-store.ts");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../api/comms/callback/route.ts");
  const orgA = createOrganization("Callback Org A");
  const orgB = createOrganization("Callback Org B");
  const teamA = createWorkspace("Callback Team A", orgA.id);
  const teamB = createWorkspace("Callback Team B", orgB.id);
  setRelayConfig({ url: "https://relay.example.test/hook", ownerOrgId: orgA.id });
  process.env.COMMS_CALLBACK_SECRET = "s3cret-callback";
  const mk = (label: string, workspaceId: string) =>
    createPipelineEntry({ candidateId: `cand-${label}`, candidateLabel: label, jobId: `job-${label}`, jobTitle: "Engineer", workspaceId }).entry;
  const own = mk("cb-own", teamA.id);
  const foreign = mk("cb-foreign", teamB.id);
  for (const e of [own, foreign]) {
    recordOutbox({ recipient: "jana@example.cz", subject: "Offer", body: "…", kind: "offer", channel: "webhook", status: "sent", ref: e.id, messageId: `msg-${e.id}` });
  }
  const call = async (ref: string, outcome: string) => {
    const res = await POST(
      new NextRequest("http://localhost/api/comms/callback", {
        method: "POST",
        headers: { "x-comms-secret": "s3cret-callback", "x-comms-timestamp": String(Date.now()), "content-type": "application/json" },
        body: JSON.stringify({ ref, kind: "offer", outcome, messageId: `msg-${ref}` }),
      })
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    const refused = await call(foreign.id, "bounce");
    assert.equal(refused.status, 200);
    assert.equal(refused.body.recorded, false);
    assert.equal(refused.body.reason, "unknown_ref", "indistinguishable from a ref the install does not know");
    assert.equal(listOutboxFiltered({ ref: foreign.id, status: "bounced" }, teamB.id).length, 0, "no receipt filed in org B");
    await call(foreign.id, "delivered");
    assert.equal(listOutboxFiltered({ ref: foreign.id }, teamB.id)[0].lastDeliveredAt, null, "org B's send not stamped");

    // Control: the SAME relay's receipt for its own org's ref still lands.
    const accepted = await call(own.id, "bounce");
    assert.equal(accepted.body.recorded, true);
    assert.equal(listOutboxFiltered({ ref: own.id, status: "bounced" }, teamA.id).length, 1);
  } finally {
    delete process.env.COMMS_CALLBACK_SECRET;
    setRelayConfig({ url: null, ownerOrgId: orgA.id });
  }
});

// S-4 — a sealed/offline calendar call's error quoted the WHOLE URL, and the revoke
// call carries the OAuth token in its query: any log of that message leaked it.
test("calendar: a sealed or offline refusal names the endpoint, never the token in its query", async () => {
  const { calendarFetch, CalendarOfflineError } = await import("./calendar/edge-fetch.ts");
  const calls = countFetches();
  const url = "https://oauth2.googleapis.com/revoke?token=1%2F%2Frefresh-token-secret";
  for (const env of [{ KP_NO_COMMS_EGRESS: "1" }, { KP_OFFLINE: "1" }]) {
    await assert.rejects(calendarFetch(url, { method: "POST" }, { env }), (err: unknown) => {
      assert.ok(err instanceof CalendarOfflineError);
      assert.doesNotMatch(err.message, /refresh-token-secret|token=/);
      assert.match(err.message, /oauth2\.googleapis\.com\/revoke/);
      return true;
    });
  }
  assert.equal(calls.length, 0);
});
