// W2.3 — stop outreaching someone who already answered.
//
// kp could send outreach but had no memory of having sent it: `dispatchOutreach` gated on
// consent and then fired, so a campaign re-run mailed the same person again — including
// people who had already written back. A competitor sells "sentiment analysis halts
// outreach on reply" as a feature; the honest framing is that continuing to sequence
// someone who replied is a bug, and this is the state that makes it impossible.
//
// The state is per PIPELINE ENTRY (candidate × role), not per candidate. A reply about
// the backend opening should not silence a genuinely separate conversation about a
// different role — but it must absolutely silence the sequence it answered.
//
// This module is the pure policy so the rules are testable without a database;
// outreach-state-store.ts persists it.

export type HaltReason = "replied" | "manual";

export type OutreachState = {
  /** How many outreach messages have gone out on this entry. */
  sends: number;
  lastSentAt: string | null;
  /** When an inbound message was recognised as a reply to our outreach. */
  repliedAt: string | null;
  /** Set when a recruiter halts the sequence by hand. */
  manualHaltAt: string | null;
};

export const EMPTY_OUTREACH_STATE: OutreachState = {
  sends: 0,
  lastSentAt: null,
  repliedAt: null,
  manualHaltAt: null,
};

/**
 * Why outreach must not go out, or null when it may.
 *
 * A manual halt outranks a reply in the reported reason: if a recruiter deliberately
 * stopped the sequence, that is the fact worth surfacing, and it stays true even if a
 * reply later arrives.
 */
export function outreachHaltReason(state: OutreachState | null | undefined): HaltReason | null {
  if (!state) return null;
  if (state.manualHaltAt) return "manual";
  if (state.repliedAt) return "replied";
  return null;
}

/**
 * Is an inbound message from a known candidate a REPLY to our outreach?
 *
 * Only when we actually reached out first. The inbound path recognises a returning
 * candidate by email, but "we have seen this address before" covers two very different
 * events: someone answering our outreach, and someone applying through the portal a
 * second time. Treating a re-application as a reply would halt a sequence that never
 * ran and mark an inbound-sourced candidate as contacted — so the send counter, not the
 * duplicate flag, is what makes it a reply.
 */
export function isReplyToOutreach(state: OutreachState | null | undefined): boolean {
  return !!state && state.sends > 0;
}

/** Apply a recognised reply. Idempotent: a candidate who sends three follow-ups keeps
 *  the FIRST reply timestamp, which is the one that answers "how fast did they respond". */
export function withReply(state: OutreachState, at: string): OutreachState {
  return state.repliedAt ? state : { ...state, repliedAt: at };
}

/** Apply a send. */
export function withSend(state: OutreachState, at: string): OutreachState {
  return { ...state, sends: state.sends + 1, lastSentAt: at };
}
