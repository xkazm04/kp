// WHAT IS WAITING ON THE CANDIDATE — the pure half of the status page's
// "Waiting on you" card (challenge-r06 application-status-page/B).
//
// The status link is forwardable, so its payload must be safe for a stranger
// (registry: candidate-safe-status-projection). These cases pin that the page
// NAMES the pending action and its deadline and never carries the capability:
//   - precedence: an open offer outranks a booking invite, which outranks an
//     untaken AI interview;
//   - a dead capability (an expired invite, a lapsed offer, a completed or
//     revoked interview) is never pointed at;
//   - a closed application, or an erased one, has nothing waiting;
//   - the projection is three keys, and no token, id or URL ever rides it;
//   - the resend decision and its copy mirror link recovery: address on file only,
//     never an anonymized record, once per cooldown, copy chosen from the relay
//     flag alone so the answer cannot probe whether an address exists.
// The route-level half (outbox rows, cooldown, refusals) is
// app/api/status/status-resend.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INTERVIEW_INVITE_TTL_DAYS,
  candidateNextAction,
  decideActionResend,
  resendMessageKey,
  type NextActionInput,
} from "./candidate-next-action.ts";

const DAY = 86_400_000;
const T = Date.parse("2026-09-10T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function input(over: Partial<NextActionInput> = {}): NextActionInput {
  return { entryStatus: "active", invites: [], openOffer: null, interview: null, nowMs: T, ...over };
}

test("a pending booking invite is 'book_interview', open until the 7-day TTL", () => {
  const out = candidateNextAction(input({ invites: [{ status: "pending", createdAt: iso(T - DAY) }] }));
  assert.deepEqual(out, { kind: "book_interview", sentAt: iso(T - DAY), expiresAt: iso(T - DAY + 7 * DAY) });
});

test("an invite past its TTL is a dead capability: the page never points at it", () => {
  assert.equal(candidateNextAction(input({ invites: [{ status: "pending", createdAt: iso(T - 8 * DAY) }] })), null);
  // A confirmed (booked) invite is not waiting on the candidate either.
  assert.equal(candidateNextAction(input({ invites: [{ status: "confirmed", createdAt: iso(T - DAY) }] })), null);
});

test("an open offer outranks booking", () => {
  const out = candidateNextAction(
    input({
      invites: [{ status: "pending", createdAt: iso(T - DAY) }],
      openOffer: { status: "extended", createdAt: iso(T - DAY), expiresAt: iso(T + 3 * DAY) },
    })
  );
  assert.deepEqual(out, { kind: "answer_offer", sentAt: iso(T - DAY), expiresAt: iso(T + 3 * DAY) });
});

test("a lapsed offer is not answer_offer: it falls through to the next pending item, else null", () => {
  const lapsed = { status: "extended", createdAt: iso(T - 5 * DAY), expiresAt: iso(T - 3_600_000) };
  assert.equal(candidateNextAction(input({ openOffer: lapsed })), null);
  const out = candidateNextAction(input({ openOffer: lapsed, invites: [{ status: "pending", createdAt: iso(T - DAY) }] }));
  assert.equal(out?.kind, "book_interview");
});

test("an untaken candidate-mode AI interview is 'take_interview'; completed or revoked is not", () => {
  const created = { mode: "candidate", status: "created", createdAt: iso(T - DAY) };
  assert.deepEqual(candidateNextAction(input({ interview: created })), {
    kind: "take_interview",
    sentAt: iso(T - DAY),
    expiresAt: iso(T - DAY + INTERVIEW_INVITE_TTL_DAYS * DAY),
  });
  assert.equal(candidateNextAction(input({ interview: { ...created, status: "completed" } })), null);
  assert.equal(candidateNextAction(input({ interview: { ...created, status: "revoked" } })), null);
  // A recruiter's test session is not the candidate's to take.
  assert.equal(candidateNextAction(input({ interview: { ...created, mode: "test" } })), null);
  // Past the link TTL it is a dead capability too.
  assert.equal(candidateNextAction(input({ interview: { ...created, createdAt: iso(T - 8 * DAY) } })), null);
});

test("the interview TTL here is the store's INTERVIEW_LINK_TTL_DAYS, not a drifting copy", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "db", "interviews.ts"), "utf8");
  const m = /export const INTERVIEW_LINK_TTL_DAYS = (\d+);/.exec(src);
  assert.ok(m, "db/interviews.ts still declares INTERVIEW_LINK_TTL_DAYS");
  assert.equal(INTERVIEW_INVITE_TTL_DAYS, Number(m[1]));
});

test("a closed or erased application has nothing waiting, and the projection never carries a capability", () => {
  const pending = { invites: [{ status: "pending", createdAt: iso(T - DAY) }] };
  assert.equal(candidateNextAction(input({ ...pending, entryStatus: "rejected" })), null);
  assert.equal(candidateNextAction(input({ ...pending, entryStatus: "declined" })), null);
  assert.equal(candidateNextAction(input({ ...pending, anonymized: true })), null);

  // Every input the fixtures above use, with extra capability-shaped fields on the rows:
  // none of them may leak through the projection.
  const leaky = {
    invites: [{ status: "pending", createdAt: iso(T - DAY), token: "sched-token-xyz", id: "inv-1" }],
    openOffer: { status: "extended", createdAt: iso(T - DAY), expiresAt: iso(T + DAY), token: "offer-token-xyz", id: "off-1" },
    interview: { mode: "candidate", status: "created", createdAt: iso(T - DAY), token: "iv-token-xyz", id: "iv-1" },
  };
  const variants: Partial<NextActionInput>[] = [
    leaky,
    { ...leaky, openOffer: null },
    { ...leaky, openOffer: null, invites: [] },
    { invites: [], openOffer: null, interview: null },
  ];
  for (const v of variants) {
    const out = candidateNextAction(input(v));
    if (out === null) continue;
    assert.ok(Object.keys(out).every((k) => ["kind", "sentAt", "expiresAt"].includes(k)), `keys ${Object.keys(out)}`);
    const json = JSON.stringify(out);
    assert.doesNotMatch(json, /token/i);
    assert.doesNotMatch(json, /"id"|inv-1|off-1|iv-1/);
    assert.doesNotMatch(json, /http/i);
  }
});

test("decideActionResend mirrors link recovery; resendMessageKey reads ONLY the relay flag", () => {
  const base = { contact: "jana@example.invalid", anonymized: false, throttled: false, relayConfigured: true };
  assert.deepEqual(decideActionResend({ ...base, contact: null }), { send: false, reason: "no_contact" });
  assert.deepEqual(decideActionResend({ ...base, contact: "   " }), { send: false, reason: "no_contact" });
  assert.deepEqual(decideActionResend({ ...base, anonymized: true }), { send: false, reason: "anonymized" });
  assert.deepEqual(decideActionResend({ ...base, throttled: true }), { send: false, reason: "cooldown" });
  assert.deepEqual(decideActionResend(base), { send: true });

  assert.equal(resendMessageKey.length, 1, "one parameter: the relay flag, nothing about the entry");
  assert.equal(resendMessageKey(true), "resent");
  assert.equal(resendMessageKey(false), "resentNoRelay");
});
