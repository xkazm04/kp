import { getGig } from "../db/gigs";
import { listGigPlans } from "../db/gigs-plans";
import { startTask } from "../tasks";
import { continueGigLoop, gigLoopResearchParams, startGigLoop, type GigLoopDeps, type GigLoopQueued } from "./loop";

// The accept loop (loop.ts) bound to the real stores and the task hub. Reached ONLY lazily,
// from late-bound-boot.ts (the `gig_loop` registration the PATCH /api/gigs/[id] door calls
// through the leaf registry, and the `gig_research` runner's continuation), so neither the
// hub nor a route gains it on its graph. Both of the loop's tasks go in with the hub's
// priority flag: the operator's accept does not wait behind a scan's research batch.

function deps(): GigLoopDeps {
  return {
    hasPlanRound: (ws, gigId) => listGigPlans(ws, gigId).length > 0,
    enqueueResearch: (ws, gigId) => startTask("gig_research", gigLoopResearchParams(ws, gigId), ws, { priority: true }).id,
    enqueuePlans: (ws, gigIds) => startTask("gig_plans", { workspaceId: ws, gigIds }, ws, { priority: true }).id,
  };
}

/** Enqueue the loop for one gig of the workspace; null when it is not there. */
export function runGigLoop(workspaceId: string, gigId: string): GigLoopQueued | null {
  const gig = getGig(workspaceId, gigId);
  return gig ? startGigLoop(workspaceId, gig, deps()) : null;
}

/** The research task's continuation: plans for the gigs research left ready. */
export function continueGigLoopAfterResearch(workspaceId: string, gigIds: readonly string[]): string | null {
  return continueGigLoop(workspaceId, gigIds, { ...deps(), getGig });
}
