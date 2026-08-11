// Pins the Assignments outbox's ordering and filtering. The guarantee that matters
// is the first one: a dead-lettered message — a rejection or offer that never
// reached the candidate — is the only row here that needs a human, so it must never
// be pushed off the first page by volume. The old table had no ordering at all and
// cut the list at 50 rows, which is exactly how that row got lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeadLetter, outboxRows } from "./outboxView.ts";
import type { OutboxItem } from "./DevTypes.ts";

const M = (id: string, status: OutboxItem["status"], createdAt: string, kind = "outreach", recipient = "a@b.c", subject = "Hello"): OutboxItem => ({
  id,
  recipient,
  subject,
  kind,
  channel: "email",
  status,
  createdAt,
});

const OUTBOX: OutboxItem[] = [
  M("new-sent", "sent", "2026-03-05T00:00:00Z"),
  M("old-failed", "failed", "2026-01-01T00:00:00Z", "rejection", "zoe@x.io", "Your application"),
  M("mid-queued", "queued", "2026-02-01T00:00:00Z", "acknowledgement"),
  M("old-bounced", "bounced", "2026-01-15T00:00:00Z", "offer", "adam@x.io", "Offer"),
];
const opts = {
  filters: { q: "", kind: "", status: "" },
  failedOnly: false,
  locale: "en",
  kindLabel: (k: string) => `k:${k}`,
  statusLabel: (s: string) => `s:${s}`,
};

test("dead letters sort to the top, however old, and never sink under newer traffic", () => {
  const ids = outboxRows(OUTBOX, opts).rows.map((m) => m.id);
  // Both dead letters are the OLDEST rows in the set; they still lead.
  assert.deepEqual(ids, ["old-bounced", "old-failed", "new-sent", "mid-queued"]);
});

test("`queued` is not a failure — it is the terminal local state", () => {
  assert.equal(isDeadLetter(M("q", "queued", "2026-01-01T00:00:00Z")), false);
  assert.equal(isDeadLetter(M("f", "failed", "2026-01-01T00:00:00Z")), true);
  assert.equal(isDeadLetter(M("b", "bounced", "2026-01-01T00:00:00Z")), true);
  assert.equal(outboxRows(OUTBOX, opts).failedCount, 2);
});

test("the dead-letter chip narrows to exactly the rows needing a human", () => {
  const ids = outboxRows(OUTBOX, { ...opts, failedOnly: true }).rows.map((m) => m.id);
  assert.deepEqual(ids, ["old-bounced", "old-failed"]);
});

test("search covers recipient AND subject, and the column filters compose", () => {
  const ids = (f: Partial<typeof opts.filters>) =>
    outboxRows(OUTBOX, { ...opts, filters: { ...opts.filters, ...f } }).rows.map((m) => m.id);
  assert.deepEqual(ids({ q: "zoe" }), ["old-failed"], "matches the recipient");
  assert.deepEqual(ids({ q: "offer" }), ["old-bounced"], "matches the subject too");
  assert.deepEqual(ids({ kind: "rejection" }), ["old-failed"]);
  assert.deepEqual(ids({ status: "sent" }), ["new-sent"]);
  assert.deepEqual(ids({ kind: "rejection", status: "sent" }), [], "a contradictory pair is empty, not everything");
});

test("facets offer only present values; status keeps severity order, worst first", () => {
  const { facets } = outboxRows(OUTBOX, opts);
  assert.deepEqual(facets.statuses.map((o) => o.value), ["bounced", "failed", "queued", "sent"]);
  assert.deepEqual(facets.kinds.map((o) => o.value).sort(), ["acknowledgement", "offer", "outreach", "rejection"]);
  // Only what is present: a kind nobody has sent must not appear in the menu.
  const one = outboxRows([OUTBOX[0]], opts);
  assert.deepEqual(one.facets.kinds.map((o) => o.value), ["outreach"]);
  assert.deepEqual(one.facets.statuses.map((o) => o.value), ["sent"]);
});

test("outboxRows never mutates the input array", () => {
  const order = OUTBOX.map((m) => m.id);
  outboxRows(OUTBOX, opts);
  assert.deepEqual(OUTBOX.map((m) => m.id), order);
});
