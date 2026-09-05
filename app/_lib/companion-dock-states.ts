import type { CompanionProposal } from "./db/companion";

/*
 * The dock's pure decisions — the half of `useCompanionThread` that is a
 * function of the server's answer rather than of React.
 *
 * They live here, outside the hook, because each one was a rule stated in a
 * comment and enforced nowhere: "take the response's proposal whatever the
 * status", "one representation per failed send", "retry replaces the failed
 * bubble". A rule in a comment is a rule a refactor can drop silently; a rule
 * in a tested function is not.
 */

/** Every optimistic bubble carries this prefix, which is what makes an unsent
 *  message distinguishable from a stored one without a second list. */
export const OPTIMISTIC_PREFIX = "optimistic-";

export type ProposalAnswer = {
  /** The server's current row for this proposal, when it sent one. */
  proposal: CompanionProposal | null;
  /** The refusal code, only when there is no row to repaint. */
  code: string | null;
};

/**
 * What the resolve route's response means.
 *
 * The row WINS over the status. A 409 says "someone already answered this" and
 * now carries the answered row beside the code, so the honest repaint is the
 * server's fact, not an error: the card closes. A code with no row is a genuine
 * failure (a 429, a 500, a transport error) and the card re-arms and says so.
 */
export function readProposalAnswer(
  body: { proposal?: CompanionProposal | null; code?: string | null } | null | undefined,
  fallbackCode = "COMPANION_PROPOSAL_FAILED"
): ProposalAnswer {
  const proposal = body?.proposal ?? null;
  if (proposal) return { proposal, code: null };
  return { proposal: null, code: body?.code ?? fallbackCode };
}

/**
 * The transcript with every unsent bubble removed.
 *
 * Retry re-sends through `send`, which pushes a fresh optimistic bubble; without
 * this the refused message was drawn twice and a second failure three times.
 * Dropping ALL optimistic turns rather than one id is deliberate: sends coalesce,
 * so several bubbles can share the one dispatch that failed, and a success
 * replaces the whole list with server truth anyway.
 */
export function withoutOptimisticTurns<T extends { id: string }>(turns: T[]): T[] {
  return turns.filter((turn) => !turn.id.startsWith(OPTIMISTIC_PREFIX));
}

export type CompanionRetryTarget = "boot" | "message" | null;

/**
 * What the dock's error line should offer to do again.
 *
 * A thread that never booted is the case the dock had no answer for at all: the
 * composer was live, `send` returned false into nothing, and the error line
 * offered no retry because there was no failed MESSAGE — only a failed boot.
 */
export function companionRetryTarget(state: {
  ready: boolean;
  error: string | null;
  lastFailed: string | null;
}): CompanionRetryTarget {
  if (!state.ready) return state.error ? "boot" : null;
  return state.lastFailed ? "message" : null;
}
