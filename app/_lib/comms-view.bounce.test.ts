import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCommsView, pickBounceTarget, type OutboxRow } from "./comms-view.ts";

// Bounce ATTRIBUTION (communications-inbound-channels #2). A relay bounce is keyed
// only by (ref, kind) and carries no message identity, so the old fold marked
// EVERY prior same-(ref,kind) `sent` row bounced whenever `bounce.at >= createdAt`.
// A single late bounce for one send therefore turned a genuinely-delivered resend
// red too. The fix binds a bounce to exactly ONE send — the newest at or before the
// bounce — via `pickBounceTarget`.

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

// --- pickBounceTarget (the pure decision) ------------------------------------

test("pickBounceTarget picks the newest send at or before the bounce", () => {
  const sends = [
    { id: "A", createdAt: "2026-06-25T10:00:00Z" },
    { id: "B", createdAt: "2026-06-25T11:00:00Z" },
  ];
  assert.equal(pickBounceTarget(sends, "2026-06-25T12:00:00Z"), "B");
});

test("pickBounceTarget ignores sends AFTER the bounce", () => {
  const sends = [
    { id: "A", createdAt: "2026-06-25T10:00:00Z" },
    { id: "B", createdAt: "2026-06-25T12:00:00Z" },
  ];
  // Bounce at 11:00 can only concern the 10:00 send, never the 12:00 one.
  assert.equal(pickBounceTarget(sends, "2026-06-25T11:00:00Z"), "A");
});

test("pickBounceTarget returns null when every send is after the bounce", () => {
  const sends = [{ id: "A", createdAt: "2026-06-25T12:00:00Z" }];
  assert.equal(pickBounceTarget(sends, "2026-06-25T11:00:00Z"), null);
});

test("pickBounceTarget is deterministic on a createdAt tie (greatest id wins)", () => {
  const sends = [
    { id: "A", createdAt: "2026-06-25T10:00:00Z" },
    { id: "Z", createdAt: "2026-06-25T10:00:00Z" },
  ];
  assert.equal(pickBounceTarget(sends, "2026-06-25T11:00:00Z"), "Z");
  assert.equal(pickBounceTarget([...sends].reverse(), "2026-06-25T11:00:00Z"), "Z");
});

// --- deriveCommsView (the behavioural fix) -----------------------------------

test("a late bounce marks ONLY one send, not every prior same-(ref,kind) send", () => {
  // The #2 scenario: offer sent (A, T1), recruiter resent it (B, T2, both accepted),
  // then the relay reports a bounce at T3. The pre-fix fold marked BOTH A and B
  // bounced (T3 >= T1 AND T3 >= T2). Exactly one send may carry the bounce.
  const view = deriveCommsView([
    row({ id: "A", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "B", status: "sent", createdAt: "2026-06-25T11:00:00Z" }),
    row({ id: "bnc", status: "bounced", createdAt: "2026-06-25T12:00:00Z", body: "550 mailbox unavailable" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  const bouncedCount = view.filter((m) => m.bounced).length;
  assert.equal(bouncedCount, 1, "a single bounce receipt must not fan out over every send");
  // Bound to the newest send at or before the bounce (B), the other stays clean.
  assert.equal(byId["B"].bounced, true);
  assert.equal(byId["B"].bounceDetail, "550 mailbox unavailable");
  assert.equal(byId["A"].bounced, false);
});

test("TWO bounces on TWO sends mark BOTH — an older bounced send never reads as delivered", () => {
  // The offer goes to a wrong address (A) and the relay bounces it; the recruiter
  // corrects the address and resends (B), which bounces too. BOTH sends are
  // undeliverable. The pre-fix fold kept only the NEWEST receipt per (ref,kind), so
  // A's own receipt was folded away (it matched a send) WITHOUT marking A — the first
  // offer read as a green "sent" in the Comms Center and the drawer.
  const view = deriveCommsView([
    row({ id: "A", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "bncA", status: "bounced", createdAt: "2026-06-25T10:30:00Z", body: "550 no such user" }),
    row({ id: "B", status: "sent", createdAt: "2026-06-25T11:00:00Z" }),
    row({ id: "bncB", status: "bounced", createdAt: "2026-06-25T11:30:00Z", body: "550 mailbox full" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(view.length, 2, "each receipt folds onto its own send");
  assert.equal(byId["A"].bounced, true, "the first send bounced — it must never read as delivered");
  assert.equal(byId["A"].bounceDetail, "550 no such user", "and carries ITS bounce, not the other send's");
  assert.equal(byId["B"].bounced, true);
  assert.equal(byId["B"].bounceDetail, "550 mailbox full");
});

test("the single-send + bounce case is unchanged (regression guard)", () => {
  const view = deriveCommsView([
    row({ id: "a", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "b", status: "bounced", createdAt: "2026-06-25T11:00:00Z", body: "bounce" }),
  ]);
  assert.equal(view.length, 1);
  assert.equal(view[0].id, "a");
  assert.equal(view[0].bounced, true);
  assert.equal(view[0].bouncedAt, "2026-06-25T11:00:00Z");
});

test("a resend AFTER the bounce is still live (regression guard)", () => {
  const view = deriveCommsView([
    row({ id: "old", status: "sent", createdAt: "2026-06-25T10:00:00Z" }),
    row({ id: "bnc", status: "bounced", createdAt: "2026-06-25T11:00:00Z", body: "bounce" }),
    row({ id: "new", status: "sent", createdAt: "2026-06-25T12:00:00Z" }),
  ]);
  const byId = Object.fromEntries(view.map((m) => [m.id, m]));
  assert.equal(byId["old"].bounced, true);
  assert.equal(byId["new"].bounced, false);
});
