import type { GigAttemptStatus, GigStatus } from "./types";

// The two state machines of the Gigs module, as DATA. Pure: no db import, no clock.
// The stores (db/gigs.ts transitionGig, db/gigs-attempts.ts transitionGigAttempt) refuse
// an edge these maps do not contain with `illegal` before touching a row, and the Gig desk
// reads the same maps to decide which buttons exist - one table, two readers.
//
// Terminal states map to an empty set: a declined, expired, withdrawn, accepted or
// rejected gig never moves again; a new listing for the same work is a new row.

export const GIG_TRANSITIONS: Readonly<Record<GigStatus, readonly GigStatus[]>> = {
  new: ["suspect", "qualified", "declined", "expired", "withdrawn"],
  // An operator clearing the honeypot flag sends it back to `new` to be qualified again.
  suspect: ["new", "declined"],
  // `suspect` is an ADDED edge (not in the WP1 brief's list): upsertGigFromRaw moves a
  // `qualified` gig whose refreshed body now trips the honeypot scan back to `suspect`
  // BEFORE it can be dispatched, and that write goes through this map like any other.
  qualified: ["dispatched", "declined", "expired", "withdrawn", "suspect"],
  // `qualified` again when the attempt failed (the gig is still workable).
  dispatched: ["drafted", "qualified", "expired", "withdrawn"],
  // `dispatched` again = a revision request spawned a new attempt. `qualified` is an
  // ADDED edge (WP4, the review desk's `discard`): the operator threw the draft away
  // but the gig is still workable, exactly as after a failed attempt.
  drafted: ["in_review", "dispatched", "declined", "withdrawn", "qualified"],
  in_review: ["sent", "dispatched", "declined", "withdrawn", "qualified"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  declined: [],
  expired: [],
  withdrawn: [],
};

export const GIG_ATTEMPT_TRANSITIONS: Readonly<Record<GigAttemptStatus, readonly GigAttemptStatus[]>> = {
  dispatched: ["running", "drafted", "failed"],
  running: ["drafted", "failed"],
  drafted: ["approved", "revision_requested", "discarded"],
  approved: ["sent", "discarded", "revision_requested"],
  // A revision is a NEW attempt, so the revised one ends here.
  revision_requested: [],
  failed: [],
  sent: [],
  discarded: [],
};

export function canTransitionGig(from: GigStatus, to: GigStatus): boolean {
  return (GIG_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionGigAttempt(from: GigAttemptStatus, to: GigAttemptStatus): boolean {
  return (GIG_ATTEMPT_TRANSITIONS[from] ?? []).includes(to);
}

/** A gig status no transition leaves. */
export function isTerminalGigStatus(status: GigStatus): boolean {
  return (GIG_TRANSITIONS[status] ?? []).length === 0;
}

/** An attempt status no transition leaves. */
export function isTerminalGigAttemptStatus(status: GigAttemptStatus): boolean {
  return (GIG_ATTEMPT_TRANSITIONS[status] ?? []).length === 0;
}
