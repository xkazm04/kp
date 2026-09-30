import type { GigReportStage } from "../types";

// The report's stage triggers: ONE call the moments that move a gig make -
//
//   researched  gigs/research.ts, after a brief is stored
//   planned     gigs/plans.ts, after a gig's plan round finished
//   accepted    POST /api/gigs/[id]/plans/[planId]/accept
//   drafted     gigs/sync.ts, when a run's deliverable lands
//   sent        gigs/review.ts, on mark_sent
//   closed      gigs/outcome.ts (a verdict), PATCH /api/gigs/[id] (decline / withdraw of a
//               gig that already has a report)
//
// - which asks for a `gig_report` task for the gig. A LEAF with no imports, so none of those
// modules (nor a route) gains the task hub or the report runner on its graph: the enqueuer is
// registered at boot (late-bound-boot.ts) and held on globalThis, the same shape as
// task-external-runners.ts (next evaluates a module once per bundle).
//
// Best-effort by contract: a report is a view of the gig, never part of the move that
// triggered it, so requestGigReport never throws and an unregistered enqueuer is a no-op.
// The requested stage is a hint - the runner reads the records and writes the stage they
// say - and the task's dedupe (one per gig) folds a burst of moves into one run.
//
// In a `node --test` process late-bound-boot.ts does NOT register the real enqueuer: a unit
// test that moves a gig must never start a model call. A test that means to observe a trigger
// registers its own (report-trigger.test.ts).

export type GigReportEnqueuer = (workspaceId: string, gigId: string, stage: GigReportStage) => void | Promise<unknown>;

const KEY = "__kpGigReportEnqueuer";
const holder = globalThis as typeof globalThis & { [KEY]?: GigReportEnqueuer | null };

/** Boot-time registration; null unregisters (tests). */
export function registerGigReportEnqueuer(enqueue: GigReportEnqueuer | null): void {
  holder[KEY] = enqueue;
}

/** Ask for the gig's report to be (re)written - fire and forget. True when an enqueuer was
 *  asked (not a promise that a task started: the enqueuer is async and may refuse). Never
 *  throws, and never rejects. */
export function requestGigReport(workspaceId: string, gigId: string, stage: GigReportStage): boolean {
  const enqueue = holder[KEY];
  if (!enqueue) return false;
  const warn = (error: unknown) => console.warn(`[gigs:report] could not enqueue the ${stage} report for ${gigId}`, error);
  try {
    const pending = enqueue(workspaceId, gigId, stage);
    if (pending && typeof (pending as Promise<unknown>).catch === "function") (pending as Promise<unknown>).catch(warn);
  } catch (error) {
    warn(error);
  }
  return true;
}
