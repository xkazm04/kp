import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveCommsView, type OutboxRow } from "./comms-view.ts";

function row(p: Partial<OutboxRow> & { id: string; status: OutboxRow["status"]; createdAt: string }): OutboxRow {
  return {
    recipient: "jane@example.com",
    subject: "s",
    body: null,
    kind: "offer",
    channel: "webhook",
    ref: "ent_1",
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
