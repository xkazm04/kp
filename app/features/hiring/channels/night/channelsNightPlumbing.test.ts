// The plumbing model against the Night Post contest's three sample states (fresh / partial /
// live, .contest/arena/channels-setup/judging/entries/B/data/channels.json), rebuilt here as
// compact fixtures with the same counts: the prototype's honesty rules are the spec.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Message } from "../channelsCommsHelpers.ts";
import type { EdgeState } from "./channelsNightReads.ts";
import {
  NEEDS_SHOWN, countVerdicts, plumbingFigures, plumbingHeadline, plumbingPlates, rankNeeds, relayOn,
  type PlumbingInput, type ReceiverFacts,
} from "./channelsNightPlumbing.ts";

let seq = 0;
function msgs(n: number, over: Partial<Message>): Message[] {
  return Array.from({ length: n }, () => ({
    id: `m${++seq}`, recipient: "a@example.com", subject: "s", body: null, kind: "rejection", channel: "webhook",
    status: "sent", ref: `r${seq}`, createdAt: "2026-09-29T10:00:00.000Z", ...over,
  }) as Message);
}
function hook(token: string, channel: "email" | "boards", received: number, accepted: number, pull?: { at?: string; error?: string }): ReceiverFacts {
  return {
    token, channel, jobId: `job-${token}`, jobTitle: `Role ${token}`, receivedCount: received, acceptedCount: accepted,
    firstReceivedAt: received ? "2026-09-20T10:00:00.000Z" : null,
    pullUrl: pull ? "https://feeds.example.com/x" : null, lastPullAt: pull?.at ?? null, lastPullError: pull?.error ?? null,
  };
}
const NO_EDGE: EdgeState = {
  url: "", hasSecret: false, sealed: false, cursor: 0, lastDrainAt: null, lastHeartbeatAt: null, pending: null,
  lastErrorKind: null, nudgeTarget: null, envConfigured: false, offline: false,
};
const PAIRED: EdgeState = {
  ...NO_EDGE, url: "https://edge.example.workers.dev", hasSecret: true, sealed: true, cursor: 1284,
  lastDrainAt: "2026-09-29T11:46:00.000Z", lastHeartbeatAt: "2026-09-29T11:58:00.000Z", pending: 3,
};
const roles = Array.from({ length: 8 }, (_, i) => ({ id: `job-${i}` }));

const FRESH: PlumbingInput = {
  jobs: roles, receivers: [hook("e1", "email", 0, 0), hook("b1", "boards", 0, 0)], receiversTruncated: false,
  waiting: 17, messages: msgs(24, { status: "queued" }), olderExist: false, relay: "unconfigured", edge: NO_EDGE, settled: true,
};
const PARTIAL: PlumbingInput = {
  ...FRESH,
  receivers: [hook("e1", "email", 0, 0), hook("b2", "boards", 31, 12, { at: "2026-09-29T11:00:00.000Z" }), hook("b3", "boards", 8, 0, { at: "2026-09-29T11:00:00.000Z", error: "HTTP 401" })],
  waiting: 9,
  messages: [...msgs(18, {}), ...msgs(4, { status: "queued" }), ...msgs(4, { status: "failed" }), ...msgs(4, { status: "failed", recovered: true })],
  relay: "configured",
};
const LIVE: PlumbingInput = {
  ...PARTIAL,
  receivers: [
    hook("e1", "email", 44, 19), hook("e2", "email", 61, 27), hook("e3", "email", 12, 0),
    hook("b2", "boards", 88, 31, { at: "2026-09-29T11:50:00.000Z" }), hook("b3", "boards", 40, 9, { at: "2026-09-29T11:00:00.000Z", error: "HTTP 401" }),
    hook("b4", "boards", 23, 6, { at: "2026-09-29T11:40:00.000Z" }),
  ],
  waiting: 17,
  messages: [
    ...msgs(27, {}), ...msgs(4, { status: "failed", recovered: true }), ...msgs(4, { status: "queued" }), ...msgs(4, { status: "failed" }),
    ...msgs(4, { status: "sent", bounced: true }), ...msgs(3, { status: "bounced", orphaned: true }),
  ],
  edge: PAIRED,
};

test("fresh: the loudest fact is that queued mail is NOT sent, and the relay says so", () => {
  const needs = rankNeeds(FRESH);
  assert.equal(needs[0].key, "relayOffQueued");
  assert.equal(needs[0].n.count, 24);
  assert.deepEqual(needs[0].target, { level: 1, channel: "relay", focus: null });
  const h = plumbingHeadline(FRESH, needs);
  assert.equal(h.kind === "need" && h.need.key, "relayOffQueued");
  const p = plumbingPlates(FRESH);
  assert.equal(p.relay.condition, "off");
  assert.equal(p.relay.alert, true, "the relay is the one alert plate");
  assert.equal(p.relay.chip, "relayNotSending");
  assert.equal(p.book.chip, "bookNoneSent");
  assert.equal(p.book.alert, false, "the relay owns the problem; the ledger is not a second alarm");
});

test("fresh: configured-but-nothing-received is not 'not configured', and nothing is a green lie", () => {
  const p = plumbingPlates(FRESH);
  assert.equal(p.email.condition, "wait");
  assert.equal(p.email.fact, "receiversNothing");
  assert.equal(p.careers.condition, "live");
  assert.equal(p.feeds.condition, "off", "push only is not configured, not failing");
  assert.equal(p.edge.chip, "edgeNotPaired");
  for (const plate of Object.values(p)) assert.notEqual(plate.condition === "live" && plate.node === "relay", true);
});

test("fresh: dead letters are not measured while nothing is sent (a dash with its reason, never 0)", () => {
  const dead = plumbingFigures(FRESH).find((f) => f.key === "dead")!;
  assert.equal(dead.value, null);
  assert.equal(dead.reason, "notMeasured");
  const messages = plumbingFigures(FRESH).find((f) => f.key === "messages")!;
  assert.equal(messages.value, 24);
  assert.equal(messages.sent, 0);
});

test("partial: the dead letters lead, the failing pull follows (it outranks its own reached-none-filed)", () => {
  const needs = rankNeeds(PARTIAL);
  assert.deepEqual(needs.slice(0, 2).map((n) => n.key), ["dead", "pullFailing"]);
  assert.equal(needs.some((n) => n.key === "reachedNoLeads"), false, "receiverHealth: a failing pull wins");
  assert.equal(needs[0].n.count, 4);
  assert.deepEqual(needs[0].target, { level: 2, verdict: "dead", role: null, from: null });
  const pull = needs.find((n) => n.key === "pullFailing")!;
  assert.deepEqual(pull.target, { level: 1, channel: "feeds", focus: "b3" });
  assert.equal(needs.some((n) => n.key === "relayOff" || n.key === "relayOffQueued"), false);
  assert.equal(needs.find((n) => n.key === "queuedWithRelay")?.n.count, 4);
  assert.equal(needs.find((n) => n.key === "edgeOff")?.sev, 35);
});

test("partial: the relay is lit only by evidence, the feeds door fails on its one failing source", () => {
  const p = plumbingPlates(PARTIAL);
  assert.equal(p.relay.condition, "live");
  assert.equal(p.relay.n.sent, 22, "sent + recovered");
  assert.equal(p.feeds.condition, "fail");
  assert.deepEqual(p.feeds.n, { count: 2, failing: 1 });
  assert.equal(p.ads.condition, "fail", "a failing pull wins over a delivering sibling");
  assert.equal(p.book.condition, "fail");
  assert.equal(p.book.n.needs, 4);
});

test("a configured relay with no send yet is 'nothing sent yet', never 'Delivering'", () => {
  const p = plumbingPlates({ ...FRESH, relay: "configured" });
  assert.equal(p.relay.condition, "wait");
  assert.equal(p.relay.chip, "relayNothingSent");
  assert.equal(rankNeeds({ ...FRESH, relay: "configured" })[0].key, "queuedWithRelay");
});

test("an unreadable relay secret is failing, not 'not configured'", () => {
  const p = plumbingPlates({ ...PARTIAL, relay: "unreadable" });
  assert.equal(p.relay.condition, "fail");
  assert.equal(p.relay.chip, "relayUnreadable");
  assert.equal(rankNeeds({ ...PARTIAL, relay: "unreadable" })[0].key, "relayUnreadable");
});

test("live: 8 need you (failed + bounced), unmatched receipts are their own item, the edge is paired with a backlog", () => {
  const c = countVerdicts(LIVE.messages!);
  assert.equal(c.needs, 8);
  assert.equal(c.dead, 11, "the ledger's dead-letter set also holds the 3 unmatched receipts");
  assert.equal(c.delivered, 31);
  const needs = rankNeeds(LIVE);
  assert.equal(needs[0].key, "dead");
  assert.deepEqual(needs[0].n, { count: 8, failed: 4, bounced: 4 });
  assert.ok(needs.some((n) => n.key === "orphaned" && n.n.count === 3));
  assert.ok(needs.some((n) => n.key === "edgePending" && n.n.count === 3));
  const p = plumbingPlates(LIVE);
  assert.equal(p.edge.condition, "live");
  assert.equal(p.edge.backlog, "waiting");
  assert.equal(p.edge.sealed, true);
  assert.equal(p.email.condition, "live");
  assert.equal(p.email.n.reach, 1);
  const dead = plumbingFigures(LIVE).find((f) => f.key === "dead")!;
  assert.equal(dead.value, 11);
  assert.equal(dead.needs, true);
});

test("worst first, and equal severities keep their order", () => {
  const needs = rankNeeds(LIVE);
  for (let i = 1; i < needs.length; i++) assert.ok(needs[i - 1].sev >= needs[i].sev);
  const reach = needs.filter((n) => n.key === "reachedNoLeads").map((n) => n.id);
  assert.deepEqual(reach, ["reach-e3"]);
});

test("nothing read yet claims nothing: every plate is unknown and the headline is 'reading'", () => {
  const blank: PlumbingInput = { jobs: null, receivers: null, receiversTruncated: false, waiting: null, messages: null, olderExist: false, relay: null, edge: null, settled: false };
  const p = plumbingPlates(blank);
  for (const plate of Object.values(p)) assert.equal(plate.condition, "unknown", plate.node);
  assert.deepEqual(rankNeeds(blank), []);
  assert.deepEqual(plumbingHeadline(blank, []), { kind: "reading" });
  for (const f of plumbingFigures(blank)) assert.equal(f.value, null);
  assert.equal(relayOn(null), null);
});

test("everything read and quiet is 'ok'; a denied read is 'okPartial', never 'ok'", () => {
  const quiet: PlumbingInput = {
    ...LIVE, receivers: [hook("e2", "email", 61, 27), hook("b2", "boards", 88, 31, { at: "2026-09-29T11:50:00.000Z" })], messages: msgs(5, {}), edge: { ...PAIRED, pending: 0 },
  };
  assert.equal(rankNeeds(quiet).filter((n) => n.sev >= NEEDS_SHOWN).length, 0);
  assert.deepEqual(plumbingHeadline(quiet, rankNeeds(quiet)), { kind: "ok" });
  const denied = { ...quiet, edge: null };
  assert.deepEqual(plumbingHeadline(denied, rankNeeds(denied)), { kind: "okPartial" });
});

test("'ok' needs proof: a relay that never sent, or a channel not set up, is never 'everything is wired and flowing'", () => {
  // The review's probe: a configured relay with nothing sent, nothing published, no receivers.
  const OFFLINE_EDGE: EdgeState = { ...NO_EDGE, offline: true };
  const bare: PlumbingInput = {
    jobs: [], receivers: [], receiversTruncated: false, waiting: 0, messages: [], olderExist: false, relay: "configured", edge: OFFLINE_EDGE, settled: true,
  };
  assert.equal(rankNeeds(bare).filter((n) => n.sev >= NEEDS_SHOWN).length, 0, "nothing needs a person");
  assert.deepEqual(plumbingHeadline(bare, rankNeeds(bare)), { kind: "quiet", relayProven: false, off: 5 });
  const paired = { ...bare, edge: { ...PAIRED, pending: 0 } };
  assert.deepEqual(plumbingHeadline(paired, rankNeeds(paired)), { kind: "quiet", relayProven: false, off: 4 });
  // Proven relay, but channels not set up: still not "doors are open".
  const sentSome: PlumbingInput = { ...bare, messages: msgs(3, {}), edge: { ...PAIRED, pending: 0 } };
  assert.deepEqual(plumbingHeadline(sentSome, rankNeeds(sentSome)), { kind: "quiet", relayProven: true, off: 4 });
  // Every channel set up, relay proven: the one case that may say so.
  const all: PlumbingInput = {
    ...sentSome, jobs: roles,
    receivers: [hook("e2", "email", 61, 27), hook("b2", "boards", 88, 31, { at: "2026-09-29T11:50:00.000Z" })],
  };
  assert.deepEqual(plumbingHeadline(all, rankNeeds(all)), { kind: "ok" });
  // Every channel set up but the relay has sent nothing yet: delivery is not proven.
  const unproven = { ...all, messages: [] };
  assert.deepEqual(plumbingHeadline(unproven, rankNeeds(unproven)), { kind: "quiet", relayProven: false, off: 0 });
});

test("only the top-ranked need's plate wears the alarm: one loud plate, never two", () => {
  const p = plumbingPlates(FRESH, rankNeeds(FRESH));
  const loud = Object.values(p).filter((x) => x.alert).map((x) => x.node);
  assert.deepEqual(loud, ["relay"]);
  assert.equal(p.book.condition, "off", "the ledger keeps its plain condition mark");
  // A need that is not the top one never alarms, even when its plate could.
  const unreadable: PlumbingInput = { ...FRESH, relay: "unreadable" };
  assert.deepEqual(Object.values(plumbingPlates(unreadable, rankNeeds(unreadable))).filter((x) => x.alert).map((x) => x.node), ["relay"]);
  for (const input of [PARTIAL, LIVE]) {
    assert.ok(Object.values(plumbingPlates(input, rankNeeds(input))).filter((x) => x.alert).length <= 1);
  }
});

test("edge: secret missing, drain failing by class, offline mode", () => {
  const secretless = plumbingPlates({ ...FRESH, edge: { ...NO_EDGE, url: "https://e.example.dev" } });
  assert.equal(secretless.edge.chip, "edgeSecretMissing");
  assert.equal(rankNeeds({ ...FRESH, edge: { ...NO_EDGE, url: "https://e.example.dev" } }).some((n) => n.key === "edgeSecretMissing"), true);
  const failing: PlumbingInput = { ...LIVE, edge: { ...PAIRED, lastErrorKind: "unreachable" } };
  assert.equal(plumbingPlates(failing).edge.condition, "fail");
  assert.equal(rankNeeds(failing).find((n) => n.key === "edgeFailing")?.failKind, "unreachable");
  const offline = { ...FRESH, edge: { ...NO_EDGE, offline: true } };
  assert.equal(plumbingPlates(offline).edge.chip, "edgeOffline");
  assert.equal(rankNeeds(offline).some((n) => n.key === "edgeOff"), false, "offline mode is a choice, not a gap");
});

test("no open roles: the careers door is off and it is a quiet item, not a headline", () => {
  const input = { ...LIVE, jobs: [] };
  assert.equal(plumbingPlates(input).careers.condition, "off");
  const item = rankNeeds(input).find((n) => n.key === "nothingPublished")!;
  assert.ok(item.sev < NEEDS_SHOWN);
});
