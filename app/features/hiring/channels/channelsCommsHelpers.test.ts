// The ledger's verdict-to-paint map and its receipt vocabulary — the one place on
// this surface where a GREEN LIE could come back.
//
// `statusTone` translates the shared verdict (comms-view.commsVerdict) into a Badge
// tone plus a catalog label. Nothing pinned it: a `bounced` or `failed` row picking
// up the positive tone is a one-character mistake, it renders as a calm green "Sent"
// over a message that never arrived, and no test would have noticed. The receipt
// helpers are pinned alongside because the Assignments outbox
// (features/tools/devcases) renders the same rows through the same two functions —
// they are a shared contract, not table-local formatting.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commsReceiptLabels,
  commsStatusLabels,
  displayRecipient,
  displaySubject,
  formatRecordedAt,
  isActionable,
  statusTone,
  type Message,
} from "./channelsCommsHelpers";
import {
  LEGACY_RECEIPT_RECIPIENT,
  LEGACY_RECEIPT_SUBJECT,
  RECEIPT_RECIPIENT_CODE,
  RECEIPT_SUBJECT_CODE,
} from "@/app/_lib/comms-view";
import { OUTBOX_STATUSES } from "@/app/_lib/comms-status";

// A translator that answers the KEY, so an assertion names the catalog entry the
// surface resolves rather than one locale's wording.
const t = ((k: string) => k) as never;
const labels = commsStatusLabels(t);
const receipts = commsReceiptLabels(t);

const msg = (over: Partial<Message>): Message =>
  ({ id: "m1", recipient: "a@b.c", subject: "Hi", body: null, kind: "ack", channel: "email", status: "sent", ref: null, createdAt: "2026-01-01T09:30:00.000Z", ...over }) as Message;

test("statusTone paints every verdict, and no undelivered row reads as sent", () => {
  const cases: Array<[Message, string, string]> = [
    [msg({ status: "sent" }), "positive", "statusSent"],
    [msg({ status: "queued" }), "info", "statusQueued"],
    [msg({ status: "failed" }), "critical", "statusFailed"],
    [msg({ status: "failed", recovered: true }), "positive", "statusRecovered"],
    [msg({ status: "sent", bounced: true }), "critical", "statusBounced"],
    [msg({ status: "bounced" as Message["status"], orphaned: true }), "caution", "orphanBadge"],
    // A raw bounce receipt that folded onto no send is an integration fault, not a
    // message — and certainly not a delivery.
    [msg({ status: "bounced" as Message["status"] }), "caution", "orphanBadge"],
  ];
  for (const [m, tone, label] of cases) {
    const got = statusTone(m, labels);
    assert.equal(got.tone, tone, `tone for ${JSON.stringify({ status: m.status, bounced: m.bounced, recovered: m.recovered, orphaned: m.orphaned })}`);
    assert.equal(got.label, label);
  }
  // The whole point, stated once more as the property: nothing undelivered is green.
  for (const m of [msg({ status: "failed" }), msg({ status: "sent", bounced: true }), msg({ status: "bounced" as Message["status"] })]) {
    assert.notEqual(statusTone(m, labels).label, labels.sent);
    assert.notEqual(statusTone(m, labels).tone, "positive");
  }
});

test("every status in the closed vocabulary has a verdict, and an off-vocabulary one is never a success", () => {
  // OUTBOX_STATUSES is the whole set (comms-status.ts) and the route coerces anything
  // else to `failed`, so `statusTone`'s default branch is a backstop, not a path — the
  // contract worth pinning is that no status, in or out of the vocabulary, can paint
  // an undelivered row as a delivery.
  for (const status of OUTBOX_STATUSES) {
    const got = statusTone(msg({ status }), labels);
    assert.ok(got.label, `no label for ${status}`);
    assert.notEqual(got.tone, undefined);
  }
  const stray = statusTone(msg({ status: "skipped" as Message["status"] }), labels);
  assert.notEqual(stray.tone, "positive");
  assert.notEqual(stray.label, labels.sent);
});

test("isActionable is the dead-letter/bounce/orphan set, and a recovered row is not in it", () => {
  assert.equal(isActionable(msg({ status: "failed" })), true);
  assert.equal(isActionable(msg({ status: "failed", recovered: true })), false);
  assert.equal(isActionable(msg({ status: "sent", bounced: true })), true);
  assert.equal(isActionable(msg({ orphaned: true })), true);
  assert.equal(isActionable(msg({ status: "sent" })), false);
  assert.equal(isActionable(msg({ status: "queued" })), false);
});

test("receipt rows show the localized label for BOTH the code and the legacy literal", () => {
  assert.equal(displaySubject({ subject: RECEIPT_SUBJECT_CODE }, receipts), "receiptSubject");
  assert.equal(displaySubject({ subject: LEGACY_RECEIPT_SUBJECT }, receipts), "receiptSubject");
  assert.equal(displayRecipient({ recipient: RECEIPT_RECIPIENT_CODE }, receipts), "receiptRecipient");
  assert.equal(displayRecipient({ recipient: LEGACY_RECEIPT_RECIPIENT }, receipts), "receiptRecipient");
});

test("a real message keeps its own subject and recipient", () => {
  assert.equal(displaySubject({ subject: "Interview confirmed" }, receipts), "Interview confirmed");
  assert.equal(displayRecipient({ recipient: "ada@example.com" }, receipts), "ada@example.com");
  // A missing one stays missing — the caller decides what an empty cell says.
  assert.equal(displaySubject({ subject: null }, receipts), null);
  assert.equal(displayRecipient({ recipient: null }, receipts), null);
});

test("formatRecordedAt carries the TIME, not just the date", () => {
  // An original and its same-day resend must be distinguishable in the column.
  const at = formatRecordedAt("2026-01-01T09:30:00.000Z", "en-GB");
  assert.match(at, /\d/);
  assert.notEqual(at, formatRecordedAt("2026-01-01T17:45:00.000Z", "en-GB"));
});
