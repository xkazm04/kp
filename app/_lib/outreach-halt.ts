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

// `candidate` is the CANDIDATE'S OWN opt-out, recorded from the public /stop/[token]
// door. It is deliberately a separate member from `manual` (the recruiter's stop): the
// two are different facts with different force. A recruiter halt is an internal workflow
// decision — pausing a sequence, and reversible by the next recruiter. A candidate
// opt-out is a legally binding objection to further commercial contact:
//   • ePrivacy Art. 13(4) — a commercial message with no valid address to decline
//     further messages is prohibited outright;
//   • Czech § 7(4)(c) with § 11(2)(a)(4) of zák. č. 480/2004 Sb. — a standalone offence,
//     fine up to 10,000,000 Kč, and Czechia is this product's primary market;
//   • German UWG § 7(2) No. 2.
// Folding it into `manual` would make the legally significant fact indistinguishable
// from the operational one, and the operational one is the one an operator may clear.
export type HaltReason = "replied" | "manual" | "candidate";

export type OutreachState = {
  /** How many outreach messages have gone out on this entry. */
  sends: number;
  lastSentAt: string | null;
  /** When an inbound message was recognised as a reply to our outreach. */
  repliedAt: string | null;
  /** Set when a recruiter halts the sequence by hand. */
  manualHaltAt: string | null;
  /** Set when the CANDIDATE opted out through the unsubscribe link in our own mail. */
  candidateHaltAt: string | null;
};

export const EMPTY_OUTREACH_STATE: OutreachState = {
  sends: 0,
  lastSentAt: null,
  repliedAt: null,
  manualHaltAt: null,
  candidateHaltAt: null,
};

/**
 * Why outreach must not go out, or null when it may.
 *
 * Precedence is by WEIGHT of the fact, not by recency. The candidate's own opt-out
 * outranks everything: it is the one reason that is a legal obligation rather than a
 * workflow state, so it must be the reason surfaced in the audit event and in the
 * recruiter UI even when a recruiter halt or a reply also happens to be on the row.
 * A manual halt then outranks a reply, for the reason it always did: a recruiter who
 * deliberately stopped the sequence stated something, and it stays true even if a reply
 * later arrives.
 *
 * NOTE this reads only the state it is handed, which is per ENTRY. The durable
 * candidate-identity resolution (an opt-out on ANY of the person's entries stops mail on
 * all of them, so a freshly minted rediscovery entry cannot re-arm the contact) lives in
 * outreach-state-store.ts, where the join is — see candidateOptOutHalt there.
 */
export function outreachHaltReason(state: OutreachState | null | undefined): HaltReason | null {
  if (!state) return null;
  if (state.candidateHaltAt) return "candidate";
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
