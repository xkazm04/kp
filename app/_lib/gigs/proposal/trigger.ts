// The proposal's trigger: ONE call the moments that should write a proposal-track gig's client
// proposal make - today the plan accept (POST /api/gigs/[id]/plans/[planId]/accept) - which
// asks for a `gig_proposal` task. A LEAF with no imports, the same shape as
// report/trigger.ts: the enqueuer is registered at boot (late-bound-boot.ts) and held on
// globalThis, so the accept route gains neither the task hub nor the proposal runner.
//
// Best-effort by contract: the proposal is written after the move, never part of it, so
// requestGigProposal never throws and an unregistered enqueuer is a no-op. In a `node --test`
// process late-bound-boot.ts registers NONE: a unit test that accepts a plan never starts a
// model call (a test that observes the trigger registers its own).

export type GigProposalEnqueuer = (workspaceId: string, gigId: string) => void | Promise<unknown>;

const KEY = "__kpGigProposalEnqueuer";
const holder = globalThis as typeof globalThis & { [KEY]?: GigProposalEnqueuer | null };

/** Boot-time registration; null unregisters (tests). */
export function registerGigProposalEnqueuer(enqueue: GigProposalEnqueuer | null): void {
  holder[KEY] = enqueue;
}

/** Ask for the gig's client proposal to be written - fire and forget. True when an enqueuer
 *  was asked. Never throws, and never rejects. */
export function requestGigProposal(workspaceId: string, gigId: string): boolean {
  const enqueue = holder[KEY];
  if (!enqueue) return false;
  const warn = (error: unknown) => console.warn(`[gigs:proposal] could not enqueue the proposal for ${gigId}`, error);
  try {
    const pending = enqueue(workspaceId, gigId);
    if (pending && typeof (pending as Promise<unknown>).catch === "function") (pending as Promise<unknown>).catch(warn);
  } catch (error) {
    warn(error);
  }
  return true;
}
