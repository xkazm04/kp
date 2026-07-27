import { test } from "node:test";
import assert from "node:assert/strict";
import { commsVerdict, deriveCommsView, type OutboxRow } from "./comms-view.ts";

function row(p: Partial<OutboxRow> & { id: string; status: OutboxRow["status"]; createdAt: string }): OutboxRow {
  return {
    recipient: "jane@example.com",
    subject: "s",
    body: null,
    kind: "offer",
    channel: "webhook",
    ref: "ent_1",
    failureDetail: null,
    ...p,
  };
}

test("a bounce receipt supersedes the matching sent row and is itself dropped", () => {
  const view = deriveCommsView([
    row({ id: "a", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "b", status: "bounced", createdAt: "2026-06-25T11:00:00Z", body: "550 mailbox unavailable" }),
  ]);
  // The receipt row is folded away — only the candidate-facing send remains.
  assert.equal(view.length, 1);
  const sent = view[0];
  assert.equal(sent.id, "a");
  assert.equal(sent.bounced, true);
  assert.equal(sent.bouncedAt, "2026-06-25T11:00:00Z");
  assert.equal(sent.bounceDetail, "550 mailbox unavailable");
});

test("a sent row with no bounce stays clean", () => {
  const view = deriveCommsView([row({ id: "a", status: "sent", createdAt: "2026-06-25T10:00:00Z" })]);
  assert.equal(view[0].bounced, false);
  assert.equal(view[0].bounceDetail, null);
});

test("a resend AFTER a bounce is not retroactively marked bounced", () => {
  // bounce at 11:00 supersedes the 10:00 send; the 12:00 resend is a fresh, live send.
  const view = deriveCommsView([
    row({ id: "old", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "bnc", status: "bounced", createdAt: "2026-06-25T11:00:00Z", body: "bounce" }),
    row({ id: "new", status: "sent", createdAt: "2026-06-25T12:00:00Z" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["old"].bounced, true);
  assert.equal(byId["new"].bounced, false); // newer than the bounce → still live
});

test("recovered behaviour is preserved: a later ok supersedes a failed dead-letter", () => {
  const view = deriveCommsView([
    row({ id: "f", status: "failed", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "ok", status: "sent", createdAt: "2026-06-25T10:30:00Z" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["f"].recovered, true);
  assert.equal(byId["f"].recoveredAt, "2026-06-25T10:30:00Z");
  assert.equal(byId["ok"].recovered, false);
});

test("an unrecovered dead-letter stays actionable", () => {
  const view = deriveCommsView([row({ id: "f", status: "failed", createdAt: "2026-06-25T10:00:00Z" })]);
  assert.equal(view[0].recovered, false);
});

test("deliverable reflects the recipient shape", () => {
  const view = deriveCommsView([
    row({ id: "addr", status: "queued", recipient: "jane@example.com", createdAt: "t1" }),
    row({ id: "name", status: "queued", recipient: "Jane Doe", createdAt: "t2", ref: "ent_2" }),
    row({ id: "lit", status: "queued", recipient: "candidate", createdAt: "t3", ref: "ent_3" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["addr"].deliverable, true);
  assert.equal(byId["name"].deliverable, false);
  assert.equal(byId["lit"].deliverable, false);
});

test("bounce supersession keys on (ref, kind) — a different kind is unaffected", () => {
  const view = deriveCommsView([
    row({ id: "offer", status: "sent", kind: "offer", createdAt: "t1" }),
    row({ id: "rej", status: "sent", kind: "rejection", createdAt: "t1" }),
    row({ id: "bnc", status: "bounced", kind: "offer", createdAt: "t2", body: "x" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["offer"].bounced, true);
  assert.equal(byId["rej"].bounced, false); // same ref, different kind
});

// --- orphan receipts (callback-unblocked) -----------------------------------
// A receipt is keyed only by (ref, kind). One that matches no send is an integrator
// vocabulary mismatch, and it used to be dropped by the same `continue` that folds a
// real receipt away — so a relay posting an unknown ref/kind looked exactly like a
// relay posting nothing at all.

test("a bounce receipt matching no send is surfaced, not dropped", () => {
  const view = deriveCommsView([
    row({ id: "sent-other", status: "sent", kind: "offer", createdAt: "t1" }),
    row({ id: "orph", status: "bounced", kind: "newsletter", createdAt: "t2", body: "550 unknown user" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(view.length, 2);
  assert.equal(byId["orph"].orphaned, true);
  // It is NOT a bounced message of ours — nothing to resend to a corrected address.
  assert.equal(byId["orph"].bounced, false);
  assert.equal(byId["orph"].status, "bounced");
  assert.equal(byId["orph"].body, "550 unknown user"); // the reported detail rides on the row
  assert.equal(byId["sent-other"].orphaned, false);
  assert.equal(byId["sent-other"].bounced, false);
});

test("a receipt that PRECEDES its send stays orphaned (a bounce can't concern a later send)", () => {
  const view = deriveCommsView([
    row({ id: "early", status: "bounced", createdAt: "t1", body: "b" }),
    row({ id: "s", status: "sent", createdAt: "t2" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["early"].orphaned, true);
  assert.equal(byId["s"].bounced, false);
});

test("a matched receipt still folds away and never reads as orphaned", () => {
  const view = deriveCommsView([
    row({ id: "s", status: "sent", createdAt: "t1" }),
    row({ id: "b", status: "bounced", createdAt: "t2", body: "550" }),
  ]);
  assert.equal(view.length, 1);
  assert.equal(view[0].id, "s");
  assert.equal(view[0].bounced, true);
  assert.equal(view[0].orphaned, false);
});

test("a receipt for a ref-less/kind-less row is orphaned (it can key onto nothing)", () => {
  const view = deriveCommsView([row({ id: "r", status: "bounced", createdAt: "t1", ref: null, kind: null })]);
  assert.equal(view.length, 1);
  assert.equal(view[0].orphaned, true);
});

// --- commsVerdict: the ONE vocabulary every surface renders --------------------
// Derived bits outrank the stored column, in order — this is the whole reason the
// Comms Center and the drawer can no longer disagree about the same message.

test("commsVerdict: a derived bit always outranks the stored status", () => {
  assert.equal(commsVerdict({ status: "sent", bounced: true }), "bounced");
  assert.equal(commsVerdict({ status: "failed", recovered: true }), "recovered");
  assert.equal(commsVerdict({ status: "bounced", orphaned: true }), "orphaned");
  // orphaned wins over bounced (an unmatched receipt is not a bounced message).
  assert.equal(commsVerdict({ status: "bounced", orphaned: true, bounced: true }), "orphaned");
});

test("commsVerdict: a clean row reads as its stored status", () => {
  assert.equal(commsVerdict({ status: "sent" }), "sent");
  assert.equal(commsVerdict({ status: "queued" }), "queued");
  assert.equal(commsVerdict({ status: "failed" }), "failed");
  // A raw receipt row that escaped the fold is named for what it is, not invented
  // into a message state.
  assert.equal(commsVerdict({ status: "bounced" }), "orphaned");
});

test("commsVerdict agrees with the view it is derived from, row by row", () => {
  const view = deriveCommsView([
    row({ id: "s", status: "sent", createdAt: "t1" }),
    row({ id: "b", status: "bounced", createdAt: "t2", body: "550" }),
    row({ id: "f", status: "failed", kind: "rejection", createdAt: "t1" }),
    row({ id: "ok", status: "sent", kind: "rejection", createdAt: "t2" }),
    row({ id: "orph", status: "bounced", kind: "newsletter", createdAt: "t3", body: "?" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, commsVerdict(m)]));
  assert.deepEqual(byId, { s: "bounced", f: "recovered", ok: "sent", orph: "orphaned" });
});
