// The backlog offer: letters recorded `queued` while no relay existed, offered once a relay
// delivers, sent ONLY on the owner's confirmation. Driven through the real channel against
// a fake relay, on a throwaway database.
//
// unit-db.ts MUST be the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { recordOutbox, listOutboxFiltered, type OutboxEntry } from "./db/devcase.ts";
import { createPipelineEntry, listPipelineEvents, recordEntryConsent } from "./db/pipeline.ts";
import { recordCandidateOptOut } from "./outreach-state-store.ts";
import { setRelayHostLookupForTests } from "./comms.ts";
import { setEgressTransportForTests } from "./pinned-request.ts";
import { backlogOffer, confirmBacklogSend, isSuperseded, selectBacklogOffer, type BacklogResult } from "./comms-backlog.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { setSmtpConfig } from "./comms-smtp-store.ts";
import { setSmtpHostLookupForTests, setSmtpSendForTests } from "./comms-smtp-delivery.ts";
import type { SmtpMessage } from "./comms-smtp.ts";

process.env.KP_ATS_SECRET_KEY = "unit-test-smtp-key";

after(() => cleanupUnitDb());
afterEach(() => {
  setSmtpSendForTests(undefined);
  setSmtpHostLookupForTests(undefined);
  setSmtpConfig({ address: "", preset: "", password: "" });
  setEgressTransportForTests(undefined);
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

const WS = DEFAULT_WORKSPACE_ID;
const ACTOR = "human:Test Owner";

/** A fake relay; every POST body it receives is returned for inspection. */
function relay(status = 200) {
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const posts: string[] = [];
  setEgressTransportForTests(async (_url, init) => {
    posts.push(String(init.body));
    return new Response(null, { status });
  });
  return posts;
}

let seq = 0;
function entry() {
  seq += 1;
  const { entry: e } = createPipelineEntry({
    candidateId: `backlog-c-${seq}`,
    candidateLabel: `Backlog Subject ${seq}`,
    jobId: `backlog-job-${seq}`,
    jobTitle: `Backlog Role ${seq}`,
    stage: "Applied",
    contact: `backlog-${seq}@example.com`,
  });
  recordEntryConsent(e.id, "test", 365, e.workspaceId);
  return e;
}

function row(over: Partial<Parameters<typeof recordOutbox>[0]> = {}): OutboxEntry {
  seq += 1;
  return recordOutbox({
    recipient: `waiting-${seq}@example.com`,
    subject: `Letter ${seq}`,
    body: "Body of the letter.",
    kind: "rejection",
    channel: "outbox",
    status: "queued",
    ref: null,
    workspaceId: WS,
    ...over,
  });
}

/** Leave the millisecond a row was stamped in, so a later row is strictly newer. */
const tick = (r: { createdAt: string }) => {
  while (Date.now() <= Date.parse(r.createdAt)) { /* at most one millisecond */ }
};

const word = (r: BacklogResult) => (r.outcome === "skipped" ? r.reason : r.outcome);

// ---- the offer selector ----------------------------------------------------------

test("the selector offers plain queued rows only: not simulation, refused, sent, failed or bounced", () => {
  const plain = row();
  row({ channel: "simulation" });
  row({ channel: "refused", status: "failed", recipient: "", failureDetail: "no recipient" });
  row({ status: "sent", channel: "webhook" });
  row({ status: "failed", channel: "webhook", failureDetail: "http 503" });
  row({ status: "bounced", channel: "webhook" });
  const offered = selectBacklogOffer(listOutboxFiltered({ limit: 500 }, WS)).map((r) => r.id);
  assert.deepEqual(offered, [plain.id]);
});

test("a queued row a later sent row has answered is not offered; a sibling queued row is not an answer", () => {
  const e = entry();
  const waiting = row({ ref: e.id, kind: "offer" });
  tick(waiting);
  const sibling = row({ ref: e.id, kind: "offer" });
  assert.equal(isSuperseded(waiting, [waiting, sibling]), false);
  tick(sibling);
  const answered = row({ ref: e.id, kind: "offer", status: "sent", channel: "webhook" });
  assert.equal(isSuperseded(waiting, [answered, sibling, waiting]), true);
  assert.deepEqual(selectBacklogOffer([answered, sibling, waiting]).map((r) => r.id), []);
});

test("the offer is empty with no relay, and names the letters (never the body) once one delivers", () => {
  const r = row();
  assert.deepEqual(backlogOffer(WS), { relayReady: false, letters: [] });
  relay();
  const offer = backlogOffer(WS);
  assert.equal(offer.relayReady, true);
  assert.deepEqual(offer.letters.find((l) => l.id === r.id), {
    id: r.id,
    recipient: r.recipient,
    subject: r.subject,
    recordedAt: r.createdAt,
  });
});

test("saving a relay and opening the offer sends nothing", () => {
  const posts = relay();
  row();
  backlogOffer(WS);
  assert.equal(posts.length, 0);
});

// ---- the confirmed send ----------------------------------------------------------

test("a confirmed letter goes through the relay as sent and notes the owner on the candidate", async () => {
  const e = entry();
  const r = row({ ref: e.id, kind: "rejection", recipient: e.contact ?? "" });
  const posts = relay();
  tick(r);
  const [result] = await confirmBacklogSend(WS, [r.id], ACTOR);
  assert.deepEqual(result, { id: r.id, outcome: "sent" });
  assert.equal(posts.length, 1);
  assert.equal(listOutboxFiltered({ ref: e.id, kind: "rejection" }, WS).filter((m) => m.status === "sent").length, 1);
  const noted = listPipelineEvents(200, 0, ["comm_resent"], WS).filter((ev) => ev.entryId === e.id);
  assert.equal(noted.length, 1);
  assert.equal(noted[0].actor, ACTOR);
  assert.match(noted[0].detail ?? "", /owner-confirmed/);
});

test("a repeat or a double fire never sends a letter twice", async () => {
  const r = row();
  const posts = relay();
  tick(r);
  const [a, b] = await Promise.all([confirmBacklogSend(WS, [r.id], ACTOR), confirmBacklogSend(WS, [r.id], ACTOR)]);
  assert.deepEqual([...a, ...b].map(word).sort(), ["in_progress", "sent"]);
  assert.deepEqual((await confirmBacklogSend(WS, [r.id, r.id], ACTOR)).map(word), ["already_sent"]);
  assert.equal(posts.length, 1, "exactly one POST for the one letter");
  assert.equal(backlogOffer(WS).letters.some((l) => l.id === r.id), false, "a delivered letter is no longer offered");
});

test("a relay refusal is recorded failed and the letter is not offered again", async () => {
  const r = row();
  relay(400);
  tick(r);
  const [result] = await confirmBacklogSend(WS, [r.id], ACTOR);
  assert.equal(result.outcome, "failed");
  assert.equal(backlogOffer(WS).letters.some((l) => l.id === r.id), false);
});

test("letters that fail a gate are skipped and named, never sent", async () => {
  const optedOut = entry();
  const outreach = row({ ref: optedOut.id, kind: "outreach", recipient: optedOut.contact ?? "" });
  recordCandidateOptOut(optedOut.id, optedOut.workspaceId);

  const lapsed = entry();
  const expired = row({ ref: lapsed.id, kind: "rejection", recipient: lapsed.contact ?? "" });
  recordEntryConsent(lapsed.id, "test", -1, lapsed.workspaceId);

  const badAddress = row({ recipient: "Jana Novakova" });
  const good = row();
  const posts = relay();
  tick(good);

  const results = await confirmBacklogSend(WS, [outreach.id, expired.id, badAddress.id, good.id], ACTOR);
  assert.deepEqual(results.map(word), ["suppressed", "suppressed", "recipient_invalid", "sent"]);
  assert.equal(posts.length, 1, "only the letter that passed every gate left");
});

test("simulation and already-sent rows are refused by a confirmation even if named", async () => {
  const sim = row({ channel: "simulation" });
  const sent = row({ status: "sent", channel: "webhook" });
  const posts = relay();
  assert.deepEqual((await confirmBacklogSend(WS, [sim.id, sent.id], ACTOR)).map(word), ["not_offered", "not_offered"]);
  assert.equal(posts.length, 0);
});

test("a queued draft waiting for review (devcase feedback) is neither offered nor sent", async () => {
  // app/api/devcase/feedback/route.ts files an AI-drafted letter `queued` on the posting's
  // channel while it waits for the recruiter to read it. That is not a letter that waited
  // for a SENDER; only the local outbox channel's rows are.
  const draft = row({ kind: "feedback", channel: "email" });
  const devcase = row({ kind: "feedback", channel: "devcase" });
  const posts = relay();
  assert.deepEqual(backlogOffer(WS).letters.filter((l) => l.id === draft.id || l.id === devcase.id), []);
  assert.deepEqual((await confirmBacklogSend(WS, [draft.id, devcase.id], ACTOR)).map(word), ["not_offered", "not_offered"]);
  assert.equal(posts.length, 0);
});

test("another workspace's letter is not found, and nothing is sent", async () => {
  const foreign = row({ workspaceId: "backlog-other-ws" });
  const posts = relay();
  assert.deepEqual((await confirmBacklogSend(WS, [foreign.id, "out_nope"], ACTOR)).map(word), ["not_found", "not_found"]);
  assert.equal(posts.length, 0);
  assert.equal(listOutboxFiltered({}, "backlog-other-ws").filter((m) => m.status !== "queued").length, 0);
});

test("with no relay a confirmation sends nothing and says why", async () => {
  const r = row();
  assert.deepEqual((await confirmBacklogSend(WS, [r.id], ACTOR)).map(word), ["relay_not_ready"]);
});

// ---- an SMTP-only install ("a letter can leave" is relay OR SMTP) ---------------------

/** A stored SMTP sender and NO relay; the SMTP client answers 250 and records each message. */
function smtpOnly(): SmtpMessage[] {
  setSmtpConfig({ preset: "seznam", address: "owner@seznam.cz", password: "zz-backlog-app-password-zz" });
  setSmtpHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  const sent: SmtpMessage[] = [];
  setSmtpSendForTests(async (_opts, msg) => {
    sent.push(msg);
    return { ok: true, code: 250, text: "2.0.0 Ok: queued as B1" };
  });
  return sent;
}

test("no relay, a stored SMTP sender: the queued letter is offered, and the confirm sends it once with its message id", async () => {
  const r = row({ messageId: "msg-original-backlog-1" });
  assert.equal(r.messageId, "msg-original-backlog-1");
  const smtp = smtpOnly();
  const offer = backlogOffer(WS);
  assert.equal(offer.relayReady, true);
  assert.deepEqual(offer.letters.filter((l) => l.id === r.id).map((l) => l.id), [r.id]);
  assert.deepEqual((await confirmBacklogSend(WS, [r.id], ACTOR)).map(word), ["sent"]);
  assert.equal(smtp.length, 1);
  assert.equal(smtp[0].to, r.recipient);
  const rows = listOutboxFiltered({ ref: r.id, kind: "rejection" }, WS).filter((m) => m.status === "sent");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, "smtp");
  assert.equal(rows[0].messageId, "msg-original-backlog-1");
  assert.equal(smtp[0].messageId, "msg-original-backlog-1");
  assert.deepEqual((await confirmBacklogSend(WS, [r.id], ACTOR)).map(word), ["already_sent"]);
});

test("an SMTP-only install still never offers or sends a devcase feedback draft", async () => {
  const draft = row({ kind: "feedback", channel: "email" });
  const smtp = smtpOnly();
  assert.deepEqual(backlogOffer(WS).letters.filter((l) => l.id === draft.id), []);
  assert.deepEqual((await confirmBacklogSend(WS, [draft.id], ACTOR)).map(word), ["not_offered"]);
  assert.equal(smtp.length, 0);
});

test("no relay and no SMTP: no offer, and a confirmation names relay_not_ready", async () => {
  const r = row();
  const offer = backlogOffer(WS);
  assert.equal(offer.relayReady, false);
  assert.deepEqual(offer.letters, []);
  assert.deepEqual((await confirmBacklogSend(WS, [r.id], ACTOR)).map(word), ["relay_not_ready"]);
});
