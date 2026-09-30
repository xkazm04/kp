import type { Gig } from "./types";

// The accept loop (WP14). The operator (2026-09-30): "Allow to accept manually gigs in state
// New, which would indicate user preference to process in LLM loops before scoping all the
// New ones." So accepting a gig is also asking kp to work it through its model steps, in
// order, as background tasks - never inline in the request:
//
//   1. research  a `gig_research` task for THIS gig, when it has no brief or a stale one
//                (gigNeedsResearch: not the model's, or an older prompt than gig-brief-v4);
//   2. plans     a `gig_plans` task for it (seats by the brief's difficulty, plan-seats.ts)
//                when it has no plan round yet - straight away when research is not needed,
//                else AFTER the research task, which continues itself (continueGigLoop,
//                called by the research runner in late-bound-boot.ts, the way `gig_plans`
//                continues itself with `continuedAs`).
//
// It stops at the plan choice: accepting a plan is the operator's gate. It also stops when
// research moved the gig off `qualified` - a physical-work brief declines it (research.ts
// declineIfPhysical), a honeypot page quarantines it - or when a round already exists.
//
// Both tasks are enqueued with the hub's priority flag (tasks.ts startTask opts, task-pump.ts):
// they go ahead of the same workspace's ordinary queued work, a scan's research batch
// included. They never preempt a running task nor exceed the hub's slot ceiling.
//
// PURE: every effect is a function the caller hands in (loop-run.ts binds the stores and the
// task hub; loop.test.ts binds recorders). Type-only imports, so research.ts and the route can
// read gigNeedsResearch / gigLoopSteps without gaining a module.

/** Lockstep with research.ts GIG_BRIEF_PROMPT_VERSION (loop.test.ts pins them equal); a copy
 *  so the route's graph does not gain research.ts. */
export const GIG_LOOP_BRIEF_VERSION = "gig-brief-v4";

/** The model steps a gig still needs. `plans`: "now" (research is current), "after_research"
 *  (the research task continues to them) or "none" (a round exists). */
export type GigLoopSteps = { research: boolean; plans: "now" | "after_research" | "none" };

/** What the accept / process door answers: the research task's id (null = not needed), and
 *  the plans task's id, "after_research" (the research task will enqueue it) or null. */
export type GigLoopQueued = { research: string | null; plans: "after_research" | string | null };

/** No brief, a deterministic one (keyless, budget, engine error) or one written by an older
 *  prompt: the accept loop researches it again. Pure. */
export function gigNeedsResearch(gig: Pick<Gig, "brief">): boolean {
  const b = gig.brief;
  return b === null || b.source !== "llm" || b.promptVersion !== GIG_LOOP_BRIEF_VERSION;
}

/** The steps for a gig, given whether any plan round exists for it. Pure. */
export function gigLoopSteps(gig: Pick<Gig, "brief">, hasPlanRound: boolean): GigLoopSteps {
  const research = gigNeedsResearch(gig);
  return { research, plans: hasPlanRound ? "none" : research ? "after_research" : "now" };
}

export type GigLoopDeps = {
  hasPlanRound: (workspaceId: string, gigId: string) => boolean;
  /** Enqueue a `gig_research` task with gigLoopResearchParams; answers its id. */
  enqueueResearch: (workspaceId: string, gigId: string) => string;
  /** Enqueue a `gig_plans` task for these gigs; answers its id. */
  enqueuePlans: (workspaceId: string, gigIds: string[]) => string;
};

/** Enqueue what the gig still needs. The caller has already checked the status. */
export function startGigLoop(workspaceId: string, gig: Pick<Gig, "id" | "brief">, deps: GigLoopDeps): GigLoopQueued {
  const steps = gigLoopSteps(gig, deps.hasPlanRound(workspaceId, gig.id));
  const research = steps.research ? deps.enqueueResearch(workspaceId, gig.id) : null;
  if (steps.plans === "now") return { research, plans: deps.enqueuePlans(workspaceId, [gig.id]) };
  return { research, plans: steps.plans === "after_research" ? "after_research" : null };
}

/** The research task's params: the scan's shape (research.ts gigResearchTaskParams) plus the
 *  loop's two flags - research a stale brief again, then continue to plans. `workspaceId`
 *  rides in the params for the dedupe builder, which keys a loop run apart from a scan's
 *  pass over the same gig (task-dedupe.ts). */
export function gigLoopResearchParams(workspaceId: string, gigId: string) {
  return { workspaceId, sourceId: null, gigIds: [gigId], linksByGigId: {}, refresh: true, thenPlans: true };
}

/** The loop's flags on a stored `gig_research` row (read as untrusted: a retry replays them). */
export function parseGigLoopTaskParams(params: Record<string, unknown>): { refresh: boolean; thenPlans: boolean } {
  return { refresh: params.refresh === true, thenPlans: params.thenPlans === true };
}

/** The gigs research left ready for plans: still `qualified` (not declined as physical work,
 *  not quarantined, not dispatched), with a brief, and no plan round yet. Pure. */
export function gigsReadyForPlans(gigs: readonly (Pick<Gig, "id" | "status" | "brief"> | null)[], hasPlanRound: (gigId: string) => boolean): string[] {
  const out: string[] = [];
  for (const g of gigs) {
    if (g && g.status === "qualified" && g.brief !== null && !hasPlanRound(g.id) && !out.includes(g.id)) out.push(g.id);
  }
  return out;
}

/** After the loop's research: enqueue plans for the gigs still ready. The task id, or null
 *  when research stopped the loop for every gig. */
export function continueGigLoop(
  workspaceId: string,
  gigIds: readonly string[],
  deps: Pick<GigLoopDeps, "hasPlanRound" | "enqueuePlans"> & { getGig: (workspaceId: string, gigId: string) => Pick<Gig, "id" | "status" | "brief"> | null }
): string | null {
  const ready = gigsReadyForPlans(
    gigIds.map((id) => deps.getGig(workspaceId, id)),
    (id) => deps.hasPlanRound(workspaceId, id)
  );
  return ready.length > 0 ? deps.enqueuePlans(workspaceId, ready) : null;
}
