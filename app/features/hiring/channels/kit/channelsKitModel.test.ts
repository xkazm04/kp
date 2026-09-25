// The Channels kit view's data-to-rows mapping. Each assertion pins that the kit REUSES the
// current tab's decision (commsVerdict, isActionable, receiverHealth, sectionReceiverStatus,
// matchesCommsQuery) and only adds its own vocabulary: which Mark a verdict wears, which rows
// a verdict chip keeps, the ledger's order, and that an unread list is null, never zero.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../channelsCommsHelpers";
import type { ChannelWebhookRecord } from "@/app/_lib/db/channels";
import {
  VERDICT_MARK, deadCount, filterLedger, firstSentence, ledgerName, ledgerRole, receiverRow, receiverTotals,
  receiversFor, sectionMark, sortLedger, verdictCounts,
} from "./channelsKitModel";

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, recipient: `${id}@x.test`, subject: `Subject ${id}`, body: null, kind: "invite", channel: "email",
  status: "sent", ref: null, createdAt: "2026-09-20T10:00:00Z", ...over,
});
const hook = (token: string, over: Partial<ChannelWebhookRecord> = {}): ChannelWebhookRecord => ({
  token, channel: "email", jobId: "j1", jobTitle: "Designer", lang: "en", createdAt: "2026-09-01T00:00:00Z",
  receivedCount: 0, lastReceivedAt: null, firstReceivedAt: null, acceptedCount: 0, firstAcceptedAt: null,
  workspaceId: "w", pullUrl: null, hasPullSecret: false, lastPullAt: null, lastPullError: null, ...over,
});

const LEDGER = [
  msg("old-sent", { createdAt: "2026-09-01T00:00:00Z" }),
  msg("new-sent", { createdAt: "2026-09-24T00:00:00Z" }),
  msg("failed", { status: "failed", createdAt: "2026-09-02T00:00:00Z" }),
  msg("bounced", { status: "sent", bounced: true, createdAt: "2026-09-03T00:00:00Z" }),
  msg("queued", { status: "queued", createdAt: "2026-09-10T00:00:00Z" }),
  msg("recovered", { status: "failed", recovered: true, createdAt: "2026-09-11T00:00:00Z" }),
];
const Q = { verdict: null, q: "", nameOf: (m: Message) => m.recipient ?? "", subjectOf: (m: Message) => m.subject, recipientOf: (m: Message) => m.recipient };

test("the ledger order is the current table's: dead letters first, then newest first", () => {
  assert.deepEqual(sortLedger(LEDGER).map((m) => m.id), ["bounced", "failed", "new-sent", "recovered", "queued", "old-sent"]);
});

test("a verdict chip keeps its verdict; `dead` keeps what needs you (isActionable)", () => {
  assert.deepEqual(filterLedger(LEDGER, { ...Q, verdict: "queued" }).map((m) => m.id), ["queued"]);
  assert.deepEqual(filterLedger(LEDGER, { ...Q, verdict: "dead" }).map((m) => m.id), ["bounced", "failed"]);
  assert.equal(deadCount(LEDGER), 2);
});

test("search folds case and diacritics through the current matcher", () => {
  const rows = [msg("a", { subject: "Pozvánka Králová" }), msg("b")];
  assert.deepEqual(filterLedger(rows, { ...Q, q: "KRALOVA" }).map((m) => m.id), ["a"]);
});

test("verdict counts cover every chip, a zero stays a zero (the chip is disabled, not hidden)", () => {
  assert.deepEqual(verdictCounts(LEDGER), { queued: 1, sent: 2, recovered: 1, failed: 1, bounced: 1, orphaned: 0 });
});

test("each verdict wears a distinct mark shape", () => {
  const marks = Object.values(VERDICT_MARK);
  assert.equal(new Set(marks).size, marks.length);
});

test("name and role: the ref's candidate first, the recipient as a fallback, never blank", () => {
  const refs = { r1: { label: "Jana Nováková", jobTitle: "Designer" } };
  const labels = { subject: "Delivery receipt", recipient: "Relay callback" };
  assert.equal(ledgerName(msg("x", { ref: "r1" }), refs, labels), "Jana Nováková");
  assert.equal(ledgerRole(msg("x", { ref: "r1" }), refs), "Designer");
  assert.equal(ledgerName(msg("y", { recipient: null }), refs, labels), "—");
  assert.equal(ledgerRole(msg("y"), refs), null);
});

test("receivers: health drives the mark; a failing pull is the one that needs you", () => {
  assert.equal(receiverRow(hook("a")).mark, "wait");
  assert.equal(receiverRow(hook("b", { receivedCount: 3 })).mark, "caution");
  assert.equal(receiverRow(hook("c", { receivedCount: 3, acceptedCount: 2 })).mark, "ok");
  const failing = receiverRow(hook("d", { pullUrl: "https://src", lastPullError: "HTTP 500" }));
  assert.equal(failing.mark, "fail");
  assert.equal(failing.needs, true);
  assert.equal(failing.detail, "HTTP 500");
});

test("an unread receivers list is null all the way through, never a confident zero", () => {
  assert.equal(receiversFor(null, "email"), null);
  assert.deepEqual(receiverTotals(null), { received: null, leads: null });
  const list = receiversFor([hook("a", { receivedCount: 4, acceptedCount: 1 }), hook("b", { channel: "boards" })], "email");
  assert.equal(list?.length, 1);
  assert.deepEqual(receiverTotals(list), { received: 4, leads: 1 });
});

test("the section marks read the same facts as the current tab's badges", () => {
  assert.equal(sectionMark("comms", [], [], undefined), null);
  assert.equal(sectionMark("careers", null, [], undefined), null, "unread roles: no claim");
  assert.deepEqual(sectionMark("careers", [{}], [], undefined), { mark: "ok", key: "statusLive" });
  assert.deepEqual(sectionMark("email", [], [], "email"), { mark: "wait", key: "statusOff" });
  assert.equal(sectionMark("ads", [], [hook("a", { channel: "boards", receivedCount: 2 })], "boards")?.mark, "caution");
});

test("a setting row's consequence is the paragraph's first sentence", () => {
  assert.equal(firstSentence("Where mail goes. Wire a relay."), "Where mail goes.");
  assert.equal(firstSentence("No full stop"), "No full stop");
});
