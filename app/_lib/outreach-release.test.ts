// Approve before first outreach (comms scope C2a): the release is the only send, and it
// sends the message the draft named.
//
// A fixture relay (COMMS_WEBHOOK_URL + a fetch spy, the comms-dispatch-outreach.test.ts
// idiom) counts every POST; keyless (no relay) must make none.
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { anonymizeEntry, createPipelineEntry, getPipelineEntry, hasEvent, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import {
  RELEASE_LEASE_MS,
  outreachLetterApprove,
  outreachLetterById,
  outreachLetterClaimRelease,
  outreachLetterDraft,
} from "./db/outreach-letters.ts";
import { ensureDb } from "./db/core.ts";
import { draftOutreachLetter, releaseOutreachLetter } from "./outreach-release.ts";
import { haltOutreach } from "./outreach-state-store.ts";
import { sendComm, setRelayHostLookupForTests } from "./comms.ts";
import { DEFAULT_WORKSPACE_ID as WS } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setRelayHostLookupForTests(undefined);
  delete process.env.COMMS_WEBHOOK_URL;
});

const PUBLIC_LOOKUP = async () => [{ address: "93.184.216.34" }];
const APPROVER = "human:Eva Recruiter";

type Post = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
/** Point the channel at a fixture relay answering `status`; returns the recorded POSTs. */
function fixtureRelay(status: number): Post[] {
  const posts: Post[] = [];
  process.env.COMMS_WEBHOOK_URL = "https://relay.example.test/hook";
  setRelayHostLookupForTests(PUBLIC_LOOKUP);
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    posts.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return posts;
}
/** No relay, and any network call at all is recorded. */
function keyless(): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

let seq = 0;
function entry(ws = WS) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `release-c${seq}`,
    candidateLabel: `Release Candidate ${seq}`,
    jobId: `release-job-${seq}`,
    jobTitle: "Backend Engineer",
    locale: "en",
    contact: `cand${seq}@example.cz`,
    stage: "Screened",
    workspaceId: ws,
  }).entry;
}

async function approvedLetter(e = entry()) {
  const { letter } = await draftOutreachLetter(e, { subject: "A role for you", body: "We'd love to talk." }, e.workspaceId ?? WS);
  const approved = outreachLetterApprove(letter.id, { revision: letter.revision, approvedBy: APPROVER }, e.workspaceId ?? WS)!;
  return { e, letter: approved };
}

test("drafting sends nothing: 0 relay POSTs, 0 outbox rows, 1 drafted row", async () => {
  const posts = fixtureRelay(200);
  const e = entry();
  const { letter } = await draftOutreachLetter(e, { subject: "Hello", body: "A letter." }, WS);
  assert.equal(posts.length, 0);
  assert.equal(listOutboxFiltered({ ref: e.id, kind: "outreach" }).length, 0);
  assert.equal(letter.state, "drafted");
  assert.equal(hasEvent(e.id, "outreach_sent", WS), false);
});

test("approve then release makes exactly 1 POST carrying the draft's message id, and the timeline names the approver", async () => {
  const posts = fixtureRelay(200);
  const { e, letter } = await approvedLetter();
  const out = await releaseOutreachLetter(letter.id, WS, "human:Petr Releaser");
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.delivery, "sent");
  assert.equal(out.ok && out.letter.state, "released");

  assert.equal(posts.length, 1, "exactly one relay POST");
  assert.equal(posts[0].body.messageId, letter.messageId, "the envelope names the draft's message");
  assert.equal(posts[0].headers["Idempotency-Key"], letter.messageId, "…and so does the Idempotency-Key");
  const rows = listOutboxFiltered({ ref: e.id, kind: "outreach" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].messageId, letter.messageId, "…and so does the outbox row");

  const sent = listPipelineEventsForEntry(e.id, 50, WS).filter((ev) => ev.kind === "outreach_sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].actor, APPROVER, "the timeline names the person who approved the text");
});

test("a second release of a released letter sends nothing", async () => {
  const posts = fixtureRelay(200);
  const { letter } = await approvedLetter();
  await releaseOutreachLetter(letter.id, WS, APPROVER);
  const again = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.status, 409);
  assert.equal(posts.length, 1);
});

test("a letter nobody approved cannot be released", async () => {
  const posts = fixtureRelay(200);
  const e = entry();
  const { letter } = await draftOutreachLetter(e, { subject: "Hi", body: "Unapproved." }, WS);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.deepEqual(out, { ok: false, status: 409, code: "PIPELINE_MOVE_CONFLICT", extra: { state: "drafted" } });
  assert.equal(posts.length, 0);
});

test("approving a stale revision after an edit is refused", async () => {
  const e = entry();
  const { letter } = await draftOutreachLetter(e, { subject: "Hi", body: "First." }, WS);
  await draftOutreachLetter(e, { subject: "Hi", body: "Edited after the reviewer opened it." }, WS);
  assert.equal(outreachLetterApprove(letter.id, { revision: letter.revision, approvedBy: APPROVER }, WS), null);
  assert.equal(outreachLetterById(letter.id, WS)!.state, "drafted");
});

test("a halted entry is refused COMMS_SUPPRESSED and nothing is sent", async () => {
  const posts = fixtureRelay(200);
  const { e, letter } = await approvedLetter();
  haltOutreach(e.id, WS);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.deepEqual(out, { ok: false, status: 409, code: "COMMS_SUPPRESSED", extra: { suppressed: "manual" } });
  assert.equal(posts.length, 0);
  assert.equal(outreachLetterById(letter.id, WS)!.state, "suppressed");
  assert.equal(hasEvent(e.id, "outreach_sent", WS), false);
});

test("a relay 500 reads delivery_failed — never a consent refusal — and a retry re-sends the SAME message", async () => {
  const posts = fixtureRelay(500);
  const { e, letter } = await approvedLetter();
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok && out.delivery, "failed");
  assert.equal(out.ok && out.letter.state, "delivery_failed");
  assert.equal(hasEvent(e.id, "outreach_sent", WS), false, "a dead letter is not a contact");
  assert.equal(hasEvent(e.id, "outreach_suppressed", WS), false, "…and not a suppression either");
  assert.ok(posts.length >= 1);
  assert.ok(posts.every((p) => p.body.messageId === letter.messageId));

  const retryPosts = fixtureRelay(200);
  const retry = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(retry.ok && retry.letter.state, "released");
  assert.equal(retryPosts.length, 1);
  assert.equal(retryPosts[0].body.messageId, letter.messageId, "the retry is the same message, which the receiver can dedupe");
});

test("keyless: the release is queued in the local outbox with 0 network calls", async () => {
  const calls = keyless();
  const { e, letter } = await approvedLetter();
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok && out.delivery, "queued");
  assert.equal(out.ok && out.letter.state, "released");
  assert.equal(calls.length, 0);
  const rows = listOutboxFiltered({ ref: e.id, kind: "outreach" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "queued");
  assert.equal(rows[0].messageId, letter.messageId);
});

test("a letter from another workspace is invisible to the release", async () => {
  const posts = fixtureRelay(200);
  const { letter } = await approvedLetter(entry("team-release-beta"));
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.deepEqual(out, { ok: false, status: 404, code: "PIPELINE_ENTRY_NOT_FOUND" });
  assert.equal(posts.length, 0);
  assert.equal(outreachLetterById(letter.id, "team-release-beta")!.state, "approved");
});

test("an erased entry's letter is blanked and can no longer be released", async () => {
  const posts = fixtureRelay(200);
  const e = entry();
  const { letter } = outreachLetterDraft({ entryId: e.id, subject: "Hi Jana", body: "Dear Jana, …", lang: "en" }, WS);
  outreachLetterApprove(letter.id, { revision: 1, approvedBy: APPROVER }, WS);
  anonymizeEntry(e.id, "erasure", WS);
  const blanked = outreachLetterById(letter.id, WS)!;
  assert.equal(blanked.subject, null);
  assert.equal(blanked.body, null);
  assert.ok(blanked.erasedAt);
  assert.ok(getPipelineEntry(e.id, WS)?.anonymizedAt);
  // A draft still being generated when the erasure landed cannot write the text back.
  outreachLetterDraft({ entryId: e.id, subject: "Hi Jana", body: "Dear Jana, again", lang: "en" }, WS);
  assert.equal(outreachLetterById(letter.id, WS)!.body, null);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, false);
  assert.equal(posts.length, 0);
});

test("a dead letter the Comms Center already resent is not released a second time", async () => {
  // The release dead-letters; a recruiter then recovers the failed outbox row through
  // /api/comms/[id]/resend, which re-sends it under the SAME message id (the route's own
  // sendComm call, reproduced here) and leaves the letter at delivery_failed. A release
  // after that must not deliver the first contact again.
  fixtureRelay(500);
  const { e, letter } = await approvedLetter();
  const failed = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(failed.ok && failed.letter.state, "delivery_failed");
  const dead = listOutboxFiltered({ ref: e.id, kind: "outreach" }).find((m) => m.status === "failed")!;

  const resendPosts = fixtureRelay(200);
  await sendComm({ to: dead.recipient!, subject: dead.subject!, body: dead.body!, kind: dead.kind!, ref: e.id, workspaceId: WS, messageId: dead.messageId! });
  assert.equal(resendPosts.length, 1, "the resend delivered the letter");

  const releasePosts = fixtureRelay(200);
  const out = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.status, 409);
  assert.equal(releasePosts.length, 0, "the letter already reached the person — nothing is sent twice");
  assert.equal(outreachLetterById(letter.id, WS)!.state, "released", "…and the row is closed truthfully");
});

test("two releases started from the same read: one claim wins, the loser gets 409 and sends nothing", async () => {
  const posts = fixtureRelay(200);
  const { letter } = await approvedLetter();
  // Two processes read the same row, then both try to claim it.
  const first = outreachLetterClaimRelease(letter, WS);
  const second = outreachLetterClaimRelease(letter, WS);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(posts.length, 0);
});

test("concurrent releases of one letter send exactly once", async () => {
  const posts = fixtureRelay(200);
  const { letter } = await approvedLetter();
  const [a, b] = await Promise.all([releaseOutreachLetter(letter.id, WS, APPROVER), releaseOutreachLetter(letter.id, WS, APPROVER)]);
  assert.equal(posts.length, 1);
  assert.equal([a, b].filter((r) => r.ok).length, 1);
  const loser = [a, b].find((r) => !r.ok)!;
  assert.equal(!loser.ok && loser.status, 409);
  assert.equal(!loser.ok && loser.code, "PIPELINE_MOVE_CONFLICT");
});

test("a release inside a live claim's lease is refused; after the lease it succeeds with the same message id", async () => {
  const posts = fixtureRelay(200);
  const { letter } = await approvedLetter();
  // Another process claimed and died (or is still sending).
  const claimed = outreachLetterClaimRelease(letter, WS)!;
  const inside = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.deepEqual(inside, { ok: false, status: 409, code: "PIPELINE_MOVE_CONFLICT", extra: { state: "approved" } });
  assert.equal(posts.length, 0);

  // Age the claim past the lease.
  const old = new Date(Date.now() - RELEASE_LEASE_MS - 1000).toISOString().replace(/Z$/, "+00:00");
  ensureDb().prepare(`UPDATE outreach_letters SET updated_at = ? WHERE id = ?`).run(old, claimed.id);
  const after = await releaseOutreachLetter(letter.id, WS, APPROVER);
  assert.equal(after.ok && after.letter.state, "released");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.messageId, letter.messageId);
});
