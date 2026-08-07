import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_OUTREACH_STATE,
  isReplyToOutreach,
  outreachHaltReason,
  withReply,
  withSend,
} from "./outreach-halt.ts";

const AT = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-31T10:00:00.000Z";

test("a fresh entry is contactable", () => {
  assert.equal(outreachHaltReason(EMPTY_OUTREACH_STATE), null);
  assert.equal(outreachHaltReason(null), null, "no state yet must not block a first touch");
});

test("having been sent to is not by itself a reason to stop", () => {
  assert.equal(outreachHaltReason(withSend(EMPTY_OUTREACH_STATE, AT)), null);
});

test("a reply halts the sequence", () => {
  const state = withReply(withSend(EMPTY_OUTREACH_STATE, AT), LATER);
  assert.equal(outreachHaltReason(state), "replied");
});

test("a manual halt outranks a reply in the reported reason", () => {
  // If a recruiter deliberately stopped the sequence, that is the fact worth surfacing,
  // and it stays true even once a reply arrives.
  const state = { ...EMPTY_OUTREACH_STATE, sends: 1, repliedAt: LATER, manualHaltAt: AT };
  assert.equal(outreachHaltReason(state), "manual");
});

test("an inbound message is a reply only if we reached out FIRST", () => {
  // The inbound path recognises a returning candidate by email, but that covers two
  // different events: answering our outreach, and re-applying through the portal.
  // Treating a re-application as a reply would halt a sequence that never ran.
  assert.equal(isReplyToOutreach(EMPTY_OUTREACH_STATE), false);
  assert.equal(isReplyToOutreach(null), false);
  assert.equal(isReplyToOutreach(withSend(EMPTY_OUTREACH_STATE, AT)), true);
});

test("the reply timestamp is the FIRST one, not the latest", () => {
  // Three follow-ups from an eager candidate must not keep resetting the clock — the
  // first reply is the one that answers "how fast did they respond".
  const once = withReply(withSend(EMPTY_OUTREACH_STATE, AT), LATER);
  const twice = withReply(once, "2026-08-01T10:00:00.000Z");
  assert.equal(twice.repliedAt, LATER);
});

test("sends accumulate and record the latest timestamp", () => {
  const s = withSend(withSend(EMPTY_OUTREACH_STATE, AT), LATER);
  assert.equal(s.sends, 2);
  assert.equal(s.lastSentAt, LATER);
});

test("the transitions are pure — the input state is never mutated", () => {
  const base = { ...EMPTY_OUTREACH_STATE };
  withSend(base, AT);
  withReply(base, AT);
  assert.deepEqual(base, EMPTY_OUTREACH_STATE);
});
