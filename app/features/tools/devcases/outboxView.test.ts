// Pins the Assignments outbox's DELIVERY VERDICT, ordering and filtering. Two
// guarantees matter here and this file exists for both:
//
//  1. A dead-lettered message — a rejection or offer that never reached the candidate —
//     is the only row that needs a human, so it must never be pushed off the first page
//     by volume. The old table had no ordering at all and cut the list at 50 rows,
//     which is exactly how that row got lost.
//  2. The verdict is DERIVED from the append-only log, never projected off the raw
//     `status` column. This table used to project it, so a bounced offer read green
//     "Sent" here while the Comms Center read red "Bounced" over the same message, the
//     relay's bounce RECEIPT sat beside it as a phantom row, and a dead letter a resend
//     had already recovered stayed in the "needs attention" chip forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeadLetter, outboxRows, outboxVerdicts } from "./outboxView.ts";
import type { OutboxItem } from "./DevTypes.ts";

const M = (
  id: string,
  status: OutboxItem["status"],
  createdAt: string,
  kind = "outreach",
  recipient = "a@b.c",
  subject = "Hello",
  ref: string | null = null
): OutboxItem => ({
  id,
  recipient,
  subject,
  kind,
  channel: "email",
  status,
  createdAt,
  ref,
  body: null,
  failureDetail: null,
});

const OUTBOX: OutboxItem[] = [
  M("new-sent", "sent", "2026-03-05T00:00:00Z"),
  M("old-failed", "failed", "2026-01-01T00:00:00Z", "rejection", "zoe@x.io", "Your application"),
  M("mid-queued", "queued", "2026-02-01T00:00:00Z", "acknowledgement"),
  M("old-bounced", "bounced", "2026-01-15T00:00:00Z", "offer", "adam@x.io", "Offer", "entry-1"),
  // The send the bounce receipt above concerns. Its raw column says `sent`; the log
  // says the relay took it and then reported it undeliverable.
  M("old-offer", "sent", "2026-01-14T00:00:00Z", "offer", "adam@x.io", "Offer", "entry-1"),
];
const opts = {
  filters: { q: "", kind: "", status: "" },
  failedOnly: false,
  locale: "en",
  kindLabel: (k: string) => `k:${k}`,
  statusLabel: (s: string) => `s:${s}`,
};
const view = (over: Partial<typeof opts> = {}) => outboxRows(OUTBOX, { ...opts, ...over });

test("a bounce receipt supersedes the green `sent` it concerns — and folds into it", () => {
  const rows = view().rows;
  // The receipt is relay signal, not a message the pipeline sent: it must not sit in
  // this ledger as its own row, and it must not be counted in the population either.
  assert.deepEqual(rows.filter((m) => m.id === "old-bounced"), [], "the receipt folds onto its send");
  assert.equal(view().total, 4, "the reported population is the derived one, receipt excluded");
  const offer = rows.find((m) => m.id === "old-offer")!;
  // The raw column on this row still says "sent". The verdict must not.
  assert.equal(offer.status, "sent");
  assert.equal(offer.verdict, "bounced", "an undeliverable offer must never read as delivered");
  assert.equal(isDeadLetter(offer), true, "…and it is the row that needs a human");
});

test("a dead letter a resend already recovered stops shouting for attention", () => {
  const rows = outboxVerdicts([
    M("dead", "failed", "2026-04-01T00:00:00Z", "rejection", "zoe@x.io", "Your application", "entry-2"),
    M("retry", "sent", "2026-04-02T00:00:00Z", "rejection", "zoe@x.io", "Your application", "entry-2"),
  ]);
  const dead = rows.find((m) => m.id === "dead")!;
  assert.equal(dead.verdict, "recovered");
  assert.equal(isDeadLetter(dead), false, "a recovered dead letter is audit, not an alarm");
  // …and the count the chip renders agrees, so the recruiter is not sent chasing it.
  assert.equal(
    outboxRows(
      [
        M("dead", "failed", "2026-04-01T00:00:00Z", "rejection", "zoe@x.io", "Your application", "entry-2"),
        M("retry", "sent", "2026-04-02T00:00:00Z", "rejection", "zoe@x.io", "Your application", "entry-2"),
      ],
      opts
    ).failedCount,
    0
  );
});

test("dead letters sort to the top, however old, and never sink under newer traffic", () => {
  const ids = view().rows.map((m) => m.id);
  // Both dead letters are the OLDEST rows in the set; they still lead.
  assert.deepEqual(ids, ["old-offer", "old-failed", "new-sent", "mid-queued"]);
});

test("`queued` is not a failure — it is the terminal local state", () => {
  const one = (status: OutboxItem["status"]) => outboxVerdicts([M("x", status, "2026-01-01T00:00:00Z")])[0];
  assert.equal(isDeadLetter(one("queued")), false);
  assert.equal(isDeadLetter(one("failed")), true);
  assert.equal(view().failedCount, 2, "the unrecovered dead letter + the bounced offer");
});

test("the dead-letter chip narrows to exactly the rows needing a human", () => {
  const ids = view({ failedOnly: true }).rows.map((m) => m.id);
  assert.deepEqual(ids, ["old-offer", "old-failed"]);
});

test("search covers recipient AND subject, and the column filters compose", () => {
  const ids = (f: Partial<typeof opts.filters>) =>
    view({ filters: { ...opts.filters, ...f } }).rows.map((m) => m.id);
  assert.deepEqual(ids({ q: "zoe" }), ["old-failed"], "matches the recipient");
  assert.deepEqual(ids({ q: "offer" }), ["old-offer"], "matches the subject too");
  assert.deepEqual(ids({ kind: "rejection" }), ["old-failed"]);
  assert.deepEqual(ids({ status: "sent" }), ["new-sent"], "the bounced offer is NOT in the sent bucket");
  assert.deepEqual(ids({ status: "bounced" }), ["old-offer"], "…it is in the bounced one");
  assert.deepEqual(ids({ kind: "rejection", status: "sent" }), [], "a contradictory pair is empty, not everything");
});

test("facets offer only present values; status keeps severity order, worst first", () => {
  const { facets } = view();
  assert.deepEqual(facets.statuses.map((o) => o.value), ["bounced", "failed", "sent", "queued"]);
  assert.deepEqual(facets.kinds.map((o) => o.value).sort(), ["acknowledgement", "offer", "outreach", "rejection"]);
  // Only what is present: a kind nobody has sent must not appear in the menu.
  const one = outboxRows([OUTBOX[0]], opts);
  assert.deepEqual(one.facets.kinds.map((o) => o.value), ["outreach"]);
  assert.deepEqual(one.facets.statuses.map((o) => o.value), ["sent"]);
});

test("outboxRows never mutates the input array", () => {
  const order = OUTBOX.map((m) => m.id);
  view();
  assert.deepEqual(OUTBOX.map((m) => m.id), order);
});
