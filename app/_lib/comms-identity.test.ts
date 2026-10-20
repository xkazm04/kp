// ONE MESSAGE IDENTITY, END TO END (channels C1).
//
// sendComm mints a `messageId` per logical message and ships it in the signed kp.comm.v1
// envelope and the Idempotency-Key header — and then threw it away: the outbox row never
// stored it, so a relay's receipt could only say (ref, kind) and the Comms Center guessed
// "the newest send before the bounce". With two same-kind sends to one candidate that
// guess marks the wrong row whenever the older one is the one that bounced.
//
// The id is now stored on `dev_outbox.message_id`, echoed by the receipt, and matched
// exactly. A row with no id (written before the column) keeps the old heuristic.
//
// unit-db.ts MUST be the first project import.
import "better-sqlite3";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { IDEMPOTENCY_HEADER } from "./comms-envelope.ts";
import { sendComm, setRelayHostLookupForTests } from "./comms.ts";
import { recordDeliveryReceipt } from "./comms-receipt.ts";
import { deriveCommsView, type OutboxRow } from "./comms-view.ts";
import { listOutboxFiltered, recordOutbox, stampOutboxDelivered } from "./db/devcase.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { ensureDb } from "./db/core.ts";

register(new URL("./testing/next-server-hooks.mjs", import.meta.url));

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

type Seen = { key: string | null; messageId: string | null };

function installRelay(): Seen[] {
  const seen: Seen[] = [];
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init.body)) as { messageId?: string | null };
    seen.push({ key: headers[IDEMPOTENCY_HEADER] ?? null, messageId: body.messageId ?? null });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return seen;
}

function entry(label: string) {
  return createPipelineEntry({ candidateId: `cand-${label}`, candidateLabel: label, jobId: `job-${label}`, jobTitle: "Engineer" }).entry;
}

const MSG = { to: "jana@example.cz", subject: "Offer", body: "…", kind: "offer" };

test("sendComm stores the minted messageId on the outbox row (relay and local outbox alike)", async () => {
  const seen = installRelay();
  const e = entry("store");
  const sent = await sendComm({ ...MSG, ref: e.id });
  assert.ok(sent.messageId, "the returned row carries the id");
  assert.equal(sent.messageId, seen[0].messageId, "…and it is the id that went on the wire");
  const stored = listOutboxFiltered({ ref: e.id })[0];
  assert.equal(stored.messageId, sent.messageId, "…and it was persisted, not just returned");

  delete process.env.COMMS_WEBHOOK_URL;
  const queued = await sendComm({ ...MSG, ref: e.id });
  assert.equal(queued.status, "queued");
  assert.ok(queued.messageId, "the keyless local outbox mints one too");
});

test("two same-kind sends: a bounce carrying the FIRST id marks only the first row", async () => {
  installRelay();
  const e = entry("two");
  const first = await sendComm({ ...MSG, ref: e.id });
  const second = await sendComm({ ...MSG, ref: e.id });
  assert.notEqual(first.messageId, second.messageId);

  const applied = recordDeliveryReceipt({ ref: e.id, kind: "offer", outcome: "bounce", messageId: first.messageId });
  assert.deepEqual(applied, { recorded: true, outcome: "bounce" });

  const view = deriveCommsView(listOutboxFiltered({ ref: e.id }));
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId[first.id].bounced, true, "the send the receipt names is the one that bounced");
  assert.equal(byId[second.id].bounced, false, "the newer same-kind send is NOT painted red");
});

test("pure: ten minutes apart, the id beats 'newest send before the bounce'", () => {
  const base = { recipient: "a@b.cz", subject: "s", kind: "offer", channel: "webhook", ref: "ent_x", failureDetail: null };
  const rows: OutboxRow[] = [
    { ...base, id: "r1", body: null, status: "sent", createdAt: "2026-10-17T10:00:00.000Z", messageId: "msg-1" },
    { ...base, id: "r2", body: null, status: "sent", createdAt: "2026-10-17T10:10:00.000Z", messageId: "msg-2" },
    { ...base, id: "b", body: "550", status: "bounced", createdAt: "2026-10-17T10:20:00.000Z", messageId: "msg-1" },
  ];
  const byId = Object.fromEntries(deriveCommsView(rows).map((m) => [m.id, m]));
  assert.equal(byId.r1.bounced, true);
  assert.equal(byId.r2.bounced, false);
});

test("a legacy row with no message_id still matches heuristically", () => {
  const base = { recipient: "a@b.cz", subject: "s", kind: "offer", channel: "webhook", ref: "ent_y", failureDetail: null };
  const rows: OutboxRow[] = [
    { ...base, id: "old", body: null, status: "sent", createdAt: "2026-10-17T10:00:00.000Z" },
    { ...base, id: "b1", body: "550", status: "bounced", createdAt: "2026-10-17T10:20:00.000Z" },
    { ...base, id: "old2", body: null, status: "sent", createdAt: "2026-10-17T10:30:00.000Z", messageId: "msg-9" },
    // A receipt that names an id no row carries must still reach the legacy (id-less) send.
    { ...base, id: "b2", body: "550", status: "bounced", createdAt: "2026-10-17T10:40:00.000Z", messageId: "msg-unknown" },
  ];
  const byId = Object.fromEntries(deriveCommsView(rows).map((m) => [m.id, m]));
  assert.equal(byId.old.bounced, true, "id-less receipt → heuristic");
  assert.equal(byId.old2.bounced, false, "an id-bearing send is not claimed by an unknown id");
});

test("a delivered receipt stamps lastDeliveredAt on the exact row; the read returns it", async () => {
  installRelay();
  const e = entry("delivered");
  const first = await sendComm({ ...MSG, ref: e.id });
  const second = await sendComm({ ...MSG, ref: e.id });
  const applied = recordDeliveryReceipt({ ref: e.id, kind: "offer", outcome: "delivered", messageId: first.messageId });
  assert.equal(applied.recorded, false, "a delivery is not a bounce");

  const byId = Object.fromEntries(deriveCommsView(listOutboxFiltered({ ref: e.id })).map((m) => [m.id, m]));
  assert.ok(byId[first.id].lastDeliveredAt, "the named row reads delivered");
  assert.ok(!byId[second.id].lastDeliveredAt, "its sibling does not");
  assert.equal(byId[first.id].bounced, false);
  // The delivered receipt is a stamp, not a ledger row.
  assert.equal(listOutboxFiltered({ ref: e.id }).length, 2);
});

test("a delivered stamp by exact id lands only on a sent or failed row (R-2)", () => {
  const e = entry("stamp-status");
  const row = (status: "queued" | "sent" | "failed" | "bounced", messageId: string) =>
    recordOutbox({ recipient: "jana@example.cz", subject: "s", body: "b", kind: "offer", channel: "webhook", status, ref: e.id, messageId });
  const queued = row("queued", "m-queued");
  const sent = row("sent", "m-sent");
  const failed = row("failed", "m-failed");
  const bounced = row("bounced", "m-bounced");

  assert.equal(stampOutboxDelivered(e.id, "offer", "m-queued"), false, "a never-sent row takes no stamp");
  assert.equal(stampOutboxDelivered(e.id, "offer", "m-bounced"), false, "a bounced row takes no stamp");
  assert.equal(stampOutboxDelivered(e.id, "offer", "m-sent"), true);
  assert.equal(stampOutboxDelivered(e.id, "offer", "m-failed"), true, "a relay may deliver after kp gave up");

  const byId = Object.fromEntries(listOutboxFiltered({ ref: e.id }).map((m) => [m.id, m]));
  assert.ok(!byId[queued.id].lastDeliveredAt);
  assert.ok(!byId[bounced.id].lastDeliveredAt);
  assert.ok(byId[sent.id].lastDeliveredAt);
  assert.ok(byId[failed.id].lastDeliveredAt);
});

test("the migration is idempotent: message_id and last_delivered_at exist, re-running ensureDb is safe", () => {
  const db = ensureDb();
  const cols = (db.prepare(`PRAGMA table_info(dev_outbox)`).all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("message_id"));
  assert.ok(cols.includes("last_delivered_at"));
  const idx = (db.prepare(`PRAGMA index_list(dev_outbox)`).all() as { name: string }[]).map((i) => i.name);
  assert.ok(idx.includes("idx_dev_outbox_message_id"));
  // A legacy row (id-less) still round-trips.
  const legacy = recordOutbox({ recipient: "x", subject: "s", body: "b", kind: "offer", channel: "outbox", status: "queued" });
  assert.equal(legacy.messageId ?? null, null);
});

test("resend reuses the original row's id as envelope messageId AND Idempotency-Key", async () => {
  const seen = installRelay();
  const e = entry("resend");
  const original = recordOutbox({
    recipient: "jana@example.cz",
    subject: "Offer",
    body: "…",
    kind: "offer",
    channel: "webhook",
    status: "failed",
    ref: e.id,
    failureDetail: "http 503",
    messageId: "msg-original-identity",
  });
  while (Date.now() <= Date.parse(original.createdAt)) { /* next ms */ }
  const { POST } = await import("../api/comms/[id]/resend/route.ts");
  const res = await POST(new Request(`http://localhost/api/comms/${original.id}/resend`, { method: "POST" }), {
    params: Promise.resolve({ id: original.id }),
  });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].messageId, "msg-original-identity");
  assert.equal(seen[0].key, "msg-original-identity");
});
