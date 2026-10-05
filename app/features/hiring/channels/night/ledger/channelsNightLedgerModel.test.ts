// The post book's rules (level 2). The ledger half moved here from the retired kit view's model test
// with its code; the rest pins the Night Post's own truths against the contest's sample states
// (.contest/arena/channels-setup/judging/entries/B/data/channels.json: fresh = 24 queued, no relay;
// live = 46 rows, 27 sent · 4 queued · 4 recovered · 4 failed · 4 bounced · 3 unmatched).
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../../channelsCommsHelpers.ts";
import {
  LEDGER_CHIPS, NO_FACETS, VERDICT_MARK, bookCondition, chipForKey, chipReading, filterLedger, humanKind,
  ledgerCounts, ledgerFacetOptions, ledgerName, ledgerRole, relayFact, scopeRoles, sortLedger, toggleVerdict,
} from "./channelsNightLedgerModel.ts";

const msg = (id: string, over: Partial<Message> = {}): Message => ({
  id, recipient: `${id}@x.test`, subject: `Subject ${id}`, body: null, kind: "invite", channel: "email",
  status: "sent", ref: null, createdAt: "2026-09-20T10:00:00Z", ...over,
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

let seq = 0;
const many = (n: number, over: Partial<Message>): Message[] => Array.from({ length: n }, () => msg(`s${++seq}`, over));
const FRESH = many(24, { status: "queued" });
const LIVE = [
  ...many(27, { status: "sent" }), ...many(4, { status: "queued" }), ...many(4, { status: "failed", recovered: true }),
  ...many(4, { status: "failed" }), ...many(4, { status: "sent", bounced: true }), ...many(3, { status: "bounced", orphaned: true }),
];

test("the ledger order: dead letters first, then newest first", () => {
  assert.deepEqual(sortLedger(LEDGER).map((m) => m.id), ["bounced", "failed", "new-sent", "recovered", "queued", "old-sent"]);
});

test("a verdict chip keeps its verdict; `dead` keeps what needs you (isActionable)", () => {
  assert.deepEqual(filterLedger(LEDGER, { ...Q, verdict: "queued" }).map((m) => m.id), ["queued"]);
  assert.deepEqual(filterLedger(LEDGER, { ...Q, verdict: "dead" }).map((m) => m.id), ["bounced", "failed"]);
});

test("search folds case and diacritics through the product's matcher", () => {
  const rows = [msg("a", { subject: "Pozvánka Králová" }), msg("b")];
  assert.deepEqual(filterLedger(rows, { ...Q, q: "KRALOVA" }).map((m) => m.id), ["a"]);
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
  assert.equal(humanKind("schedule_invite"), "Schedule invite");
});

test("the column facets keep only their role, channel and kind; empty means all", () => {
  const rows = [
    msg("a", { channel: "email", kind: "invite", ref: "e1" }),
    msg("b", { channel: "webhook", kind: "invite", ref: "e2" }),
    msg("c", { channel: "email", kind: "reject", ref: null }),
  ];
  const roleOf = (m: Message) => (m.ref === "e1" ? "Designer" : m.ref === "e2" ? "Engineer" : null);
  const ids = (facets: { role: string; channel: string; kind: string }) =>
    filterLedger(rows, { ...Q, facets, roleOf }).map((m) => m.id).sort();
  assert.deepEqual(ids(NO_FACETS), ["a", "b", "c"]);
  assert.deepEqual(ids({ ...NO_FACETS, role: "Designer" }), ["a"]);
  assert.deepEqual(ids({ ...NO_FACETS, channel: "email" }), ["a", "c"]);
  assert.deepEqual(ids({ ...NO_FACETS, kind: "invite", channel: "webhook" }), ["b"]);
});

test("facet options are the values present, deduplicated, in the reader's collation", () => {
  const rows = [msg("a", { channel: "email", kind: "invite" }), msg("b", { channel: "email", kind: null }), msg("c", { channel: "sms", kind: "offer" })];
  const roles: Record<string, string> = { a: "Zahradník", b: "Čistič", c: "Architekt" };
  const opts = ledgerFacetOptions(rows, (m) => roles[m.id], "cs");
  assert.deepEqual(opts.role, ["Architekt", "Čistič", "Zahradník"]);
  assert.deepEqual(opts.channel, ["email", "sms"]);
  assert.deepEqual(opts.kind, ["invite", "offer"]);
});

test("seven chips, needs-you first, each on its digit; a second press clears", () => {
  assert.deepEqual(LEDGER_CHIPS, ["dead", "queued", "sent", "recovered", "failed", "bounced", "orphaned"]);
  assert.equal(chipForKey("1"), "dead");
  assert.equal(chipForKey("7"), "orphaned");
  for (const k of ["0", "8", "g", "11", ""]) assert.equal(chipForKey(k), null, k);
  assert.equal(toggleVerdict(null, "failed"), "failed");
  assert.equal(toggleVerdict("failed", "failed"), null);
  assert.equal(toggleVerdict("failed", "dead"), "dead");
});

test("chip counts follow the OTHER filters (search, facets, scope), never the verdict itself", () => {
  const all = ledgerCounts(LIVE, Q);
  assert.deepEqual(all, { dead: 11, queued: 4, sent: 27, recovered: 4, failed: 4, bounced: 4, orphaned: 3 });
  const rows = [msg("a", { subject: "Offer", status: "failed" }), msg("b", { subject: "Invite" })];
  assert.deepEqual(ledgerCounts(rows, { ...Q, verdict: "sent", q: "offer" }), { dead: 1, queued: 0, sent: 0, recovered: 0, failed: 1, bounced: 0, orphaned: 0 });
});

test("with no relay, a zero on a chip only a relay can fill is a dash, not good news", () => {
  const c = ledgerCounts(FRESH, Q);
  assert.deepEqual(chipReading("failed", c.failed, false), { count: null, notMeasured: true });
  assert.deepEqual(chipReading("dead", c.dead, false), { count: null, notMeasured: true });
  // Sent 0 and Queued 24 are measured facts even with no relay: nothing was sent.
  assert.deepEqual(chipReading("sent", c.sent, false), { count: 0, notMeasured: false });
  assert.deepEqual(chipReading("queued", c.queued, false), { count: 24, notMeasured: false });
  // A real count from a time a relay was wired stays a count; a relay (or an unread bit) measures.
  assert.deepEqual(chipReading("failed", 2, false), { count: 2, notMeasured: false });
  assert.deepEqual(chipReading("failed", 0, true), { count: 0, notMeasured: false });
  assert.deepEqual(chipReading("failed", 0, null), { count: 0, notMeasured: false });
});

test("the relay fact: none wired is said with the queue; a relay with old queued rows is said too", () => {
  assert.equal(relayFact(null, false), null, "unread: no claim");
  assert.deepEqual(relayFact(FRESH, false), { kind: "off", queued: 24 });
  assert.deepEqual(relayFact([], false), { kind: "off", queued: 0 });
  assert.deepEqual(relayFact(LIVE, true), { kind: "queued", queued: 4 });
  assert.equal(relayFact(LIVE.filter((m) => m.status === "sent"), true), null);
});

test("a channel's scope: the roles it feeds; the relay and an unread list scope nothing", () => {
  const receivers = [
    { channel: "email", jobTitle: "Data Engineer", pullUrl: null },
    { channel: "email", jobTitle: "Data Engineer", pullUrl: null },
    { channel: "boards", jobTitle: "QA Lead", pullUrl: "https://feeds.example.com/qa" },
    { channel: "boards", jobTitle: "Designer", pullUrl: null },
  ];
  const jobs = [{ title: "Data Engineer" }, { title: "Designer" }, { title: "QA Lead" }];
  assert.deepEqual(scopeRoles("email", receivers, jobs), ["Data Engineer"]);
  assert.deepEqual(scopeRoles("ads", receivers, jobs), ["QA Lead", "Designer"]);
  assert.deepEqual(scopeRoles("feeds", receivers, jobs), ["QA Lead"]);
  assert.deepEqual(scopeRoles("careers", receivers, jobs), ["Data Engineer", "Designer", "QA Lead"]);
  assert.equal(scopeRoles("relay", receivers, jobs), null);
  assert.equal(scopeRoles(null, receivers, jobs), null);
  assert.equal(scopeRoles("email", null, jobs), null, "unread receivers: no scope, never an empty one");
  assert.equal(scopeRoles("careers", receivers, null), null);
});

test("a scope keeps the rows of its roles only; a row with no role is outside every scope", () => {
  const rows = [msg("a", { ref: "e1" }), msg("b", { ref: "e2" }), msg("c")];
  const roleOf = (m: Message) => (m.ref === "e1" ? "Designer" : m.ref === "e2" ? "Engineer" : null);
  assert.deepEqual(filterLedger(rows, { ...Q, roleOf, scope: ["Designer"] }).map((m) => m.id), ["a"]);
  assert.deepEqual(filterLedger(rows, { ...Q, roleOf, scope: [] }).map((m) => m.id), []);
  assert.deepEqual(filterLedger(rows, { ...Q, roleOf, scope: null }).map((m) => m.id).sort(), ["a", "b", "c"]);
});

test("the book's drawing: unread unknown, queued with no relay or a letter that needs you fails, a sent row is live", () => {
  assert.equal(bookCondition(null, false), "unknown");
  assert.equal(bookCondition(FRESH, false), "fail");
  assert.equal(bookCondition(LIVE, true), "fail");
  assert.equal(bookCondition(LIVE.filter((m) => m.status === "sent" && !m.bounced), true), "live");
  assert.equal(bookCondition([], true), "wait");
  assert.equal(bookCondition(many(2, { status: "queued" }), true), "wait");
});
