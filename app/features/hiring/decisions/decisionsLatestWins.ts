// "Latest wins" for the Decisions tab's companion reads.
//
// The queue read (`load`) has taken a ticket since the no-optimistic-removal
// rewrite: two reads can be in flight at once and a response that STARTED before
// a decision landed carries a pre-decision snapshot, so letting it settle puts a
// just-decided card back on screen. Its two COMPANION reads — the reconsider
// queue and the per-role "already evaluated" map — had no such guard and no
// cancellation: both fire from mount AND from the live-refresh bus (which fires
// from other windows too), so a slow first response could land after a fast
// second one and reinstate a row the recruiter had just reinstated away, or
// re-assert an "evaluated" chip for a role set that is no longer on screen.
//
// A ticket, not an AbortController, for the same reason `load` uses one: the
// hazard is a SETTLED response writing stale state, which abort does not cover
// (an abort that loses the race still leaves the earlier response to settle).
// The gate also gives an effect a cleanup that costs nothing — `invalidate()` on
// unmount means an in-flight read simply drops its result.
//
// Pure and React-free so it can be tested as the state machine it is; the hook
// holds one gate per read in a ref.

export interface TicketGate {
  /** Start a read. The returned ticket is the only one allowed to write until
   *  another is taken or the gate is invalidated. */
  take(): number;
  /** Invalidate every outstanding ticket without starting a read — the shape an
   *  effect cleanup or a landed mutation needs. */
  invalidate(): void;
  /** May this ticket write? */
  isLatest(ticket: number): boolean;
}

export function createTicketGate(): TicketGate {
  // Monotonic and never reset: a ticket handed out is never handed out again, so
  // a response cannot be revived by a later read reaching the same number.
  let current = 0;
  return {
    take: () => ++current,
    invalidate: () => {
      current += 1;
    },
    isLatest: (ticket: number) => ticket === current,
  };
}
