import { test } from "node:test";
import assert from "node:assert/strict";
import { commsVerdict, deriveCommsView, pageCommsFeed, type OutboxRow } from "./comms-view.ts";

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

// ---- the window is not the ledger ---------------------------------------------
//
// `orphaned` is an ACCUSATION — "the relay reported a bounce for something we never
// sent". The feed used to derive it over a fixed 200-row window, so a bounce whose
// send had merely scrolled out of that window was flagged as an integration fault.

test("a bounce with no send in a TRUNCATED window makes no orphan claim", () => {
  const rows = [row({ id: "b", status: "bounced", createdAt: "t9", body: "550" })];
  // Whole ledger: the send is genuinely absent, so the accusation stands.
  assert.equal(deriveCommsView(rows)[0].orphaned, true);
  assert.equal(commsVerdict(deriveCommsView(rows)[0]), "orphaned");
  // Same rows, but the caller says older ones exist beyond its window: the receipt is
  // still surfaced (hiding it would hide a real fault) and claims nothing.
  const truncated = deriveCommsView(rows, { windowTruncated: true });
  assert.equal(truncated.length, 1, "the receipt is still shown");
  assert.equal(truncated[0].orphaned, false, "…but not accused");
});

test("a truncated window still folds the bounces whose sends it CAN see", () => {
  const view = deriveCommsView(
    [
      row({ id: "a", status: "sent", createdAt: "t1" }),
      row({ id: "b", status: "bounced", createdAt: "t2", body: "550" }),
    ],
    { windowTruncated: true }
  );
  assert.equal(view.length, 1);
  assert.equal(view[0].bounced, true, "supersession is unchanged by the window flag");
});

// ---- the feed's cursor ---------------------------------------------------------

const page = (n: number) =>
  Array.from({ length: n }, (_, i) => row({ id: `r${i}`, status: "sent", createdAt: `t${i}` })).map((m) => ({
    ...m,
    deliverable: true,
    recovered: false,
    recoveredAt: null,
    bounced: false,
    bouncedAt: null,
    bounceDetail: null,
    orphaned: false,
  }));

test("pageCommsFeed walks the list with a cursor and stops exactly once", () => {
  const all = page(5);
  const first = pageCommsFeed(all, { limit: 2 });
  assert.deepEqual(first.messages.map((m) => m.id), ["r0", "r1"]);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "r1");
  assert.equal(first.cursorExpired, false);

  const second = pageCommsFeed(all, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.messages.map((m) => m.id), ["r2", "r3"]);
  assert.equal(second.hasMore, true);

  const third = pageCommsFeed(all, { limit: 2, cursor: second.nextCursor });
  assert.deepEqual(third.messages.map((m) => m.id), ["r4"]);
  assert.equal(third.hasMore, false, "the last page says so");
  assert.equal(third.nextCursor, null, "…and hands back no cursor to loop on");
});

test("pageCommsFeed answers an exactly-full last page without claiming another", () => {
  const p = pageCommsFeed(page(4), { limit: 2, cursor: "r1" });
  assert.deepEqual(p.messages.map((m) => m.id), ["r2", "r3"]);
  assert.equal(p.hasMore, false);
  assert.equal(p.nextCursor, null);
});

test("a cursor that aged out of the window is said out loud, not answered from nowhere", () => {
  const p = pageCommsFeed(page(3), { limit: 2, cursor: "gone" });
  assert.equal(p.cursorExpired, true);
  assert.deepEqual(p.messages.map((m) => m.id), ["r0", "r1"], "answered from the top");
});

test("an empty ledger pages to nothing rather than to a cursor", () => {
  const p = pageCommsFeed([], { limit: 10 });
  assert.deepEqual(p, { messages: [], hasMore: false, nextCursor: null, cursorExpired: false });
});
