import type { GigLoopQueued } from "@/app/_lib/gigs/loop";

// ---------------------------------------------------------------------------
// The accept loop, as the tab watches it (front/loopWatch.ts): what an accepted gig is
// waiting on, read from the two task rows the accept answered with. Pure.
// ---------------------------------------------------------------------------

/** The part of a task row the watch reads (GET /api/tasks/[id]); null = not read yet. */
export type LoopTask = { status: string; result: Record<string, unknown> | null } | null;

export type LoopWatch = {
  gigId: string;
  title: string;
  /** The research task id, or null when research was not needed. */
  research: string | null;
  /** The plans task id, "after_research", or null when no plans were queued. */
  plans: string | null;
  researchTask: LoopTask;
  plansTask: LoopTask;
};

export const LOOP_STATES = ["research_queued", "research_running", "plans_queued", "plans_running", "ready", "researched", "stopped", "failed"] as const;
export type LoopState = (typeof LOOP_STATES)[number];

const OVER = ["succeeded", "failed", "canceled", "interrupted"];

export function taskOver(t: LoopTask): boolean {
  return t !== null && OVER.includes(t.status);
}

/** The plans task to watch: queued at accept, or named by the research task when it
 *  continued (its result's `plansTask`); null when there is none (yet). */
export function plansTaskId(w: LoopWatch): string | null {
  if (w.plans && w.plans !== "after_research") return w.plans;
  const next = w.researchTask?.status === "succeeded" ? w.researchTask.result?.plansTask : null;
  return typeof next === "string" && next ? next : null;
}

function plansState(t: LoopTask): LoopState {
  if (t === null || t.status === "queued") return "plans_queued";
  if (t.status === "running") return "plans_running";
  // A run can succeed with every seat failed (keyless: `no_provider`): that is not "written".
  return t.status === "succeeded" && Number(t.result?.ready) > 0 ? "ready" : "failed";
}

/** Where the gig's loop stands; null when nothing was queued. */
export function loopState(w: LoopWatch): LoopState | null {
  if (w.research) {
    const r = w.researchTask;
    if (r === null || r.status === "queued") return "research_queued";
    if (r.status === "running") return "research_running";
    if (r.status !== "succeeded") return "failed";
    if (w.plans !== "after_research") return "researched";
    return plansTaskId(w) ? plansState(w.plansTask) : "stopped";
  }
  return w.plans ? plansState(w.plansTask) : null;
}

/** Nothing more will change without the operator. */
export function loopSettled(w: LoopWatch): boolean {
  const s = loopState(w);
  return s === null || s === "ready" || s === "researched" || s === "stopped" || s === "failed";
}

/** The sentence an accept's flash ends with (gigs.loop.queued.*). */
export function queuedKey(q: GigLoopQueued | null | undefined): "both" | "plans" | "research" | "none" {
  if (!q) return "none";
  if (q.research) return q.plans ? "both" : "research";
  return q.plans ? "plans" : "none";
}
