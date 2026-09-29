import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import type { Gig, GigAttempt, GigStatus } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// Who acts next on a gig
// ---------------------------------------------------------------------------

/** The three judgements the header counts and `N` walks, in that order; then triage (the
 *  operator's too, but not a judgement), then the kinds that sit with the agents and
 *  never pad the operator's count. */
export const NEED_KINDS = ["review", "suspect", "record"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export const QUEUE_KINDS = [...NEED_KINDS, "triage", "running", "revision", "failed"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export type QueueItem = {
  kind: QueueKind;
  /** Stable selection key: kind + gig id (one open item per gig). */
  key: string;
  gig: Gig;
  attempt: GigAttempt | null;
};

/** Which queue a gig sits in, or null when it needs nobody (declined, resolved...). */
export function queueKindOf(gig: Gig, latest: GigAttempt | null): QueueKind | null {
  if (gig.status === "suspect") return "suspect";
  if (gig.status === "sent") return "record";
  if (latest && (latest.status === "drafted" || latest.status === "approved")) return "review";
  if (latest && (latest.status === "dispatched" || latest.status === "running")) return "running";
  if (latest && latest.status === "revision_requested") return "revision";
  if (gig.status === "new") return "triage";
  if (gig.status === "qualified") return latest && latest.status === "failed" ? "failed" : "triage";
  return null;
}

// ---------------------------------------------------------------------------
// The line: arenas are rows, the lifecycle steps are columns
// ---------------------------------------------------------------------------

/** The canonical steps of the line, in order (reachedStep reads them). */
export const LINE_STEPS = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "accepted", "rejected"] as const satisfies readonly GigStatus[];
export type LineStep = (typeof LINE_STEPS)[number];
/** How far along the main line a gig has provably got. `suspect` is a side branch, not
 *  a rank; a gig that left the line is read off its latest attempt. */
const FLOW_RANK: Partial<Record<GigStatus, number>> = { new: 0, qualified: 1, dispatched: 2, drafted: 3, in_review: 4, sent: 5, accepted: 6, rejected: 6 };

function furthestRank(gig: Gig, latest: GigAttempt | null): number {
  const own = FLOW_RANK[gig.status];
  if (own !== undefined) return own;
  if (!latest) return 0;
  if (latest.status === "sent") return 5;
  if (latest.deliverable) return 3;
  return 2;
}

/** Whether any of these gigs ever reached `step`. An empty cell of a step they reached
 *  says "none here now"; one they never reached says "never reached" - the two are
 *  different facts and never render alike (Lanes, lanes.ts laneRows). */
export function reachedStep(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, step: LineStep): boolean {
  if (step === "suspect") return gigs.some((g) => g.status === "suspect" || g.suspectReasons.length > 0);
  if (step === "accepted" || step === "rejected") return gigs.some((g) => g.status === step);
  const need = FLOW_RANK[step]!;
  return gigs.some((g) => furthestRank(g, attemptsByGig[g.id] ?? null) >= need);
}

/** Whether the quick decline (`D`) is offered: exactly the statuses PATCH
 *  /api/gigs/[id] {action:"decline"} accepts, read off the same transition table. */
export function canQuickDecline(status: GigStatus): boolean {
  return canTransitionGig(status, "declined");
}

/** The rejected streak's tone as it nears the auto-pause: calm under 40% of the limit
 *  (0 of 5 reads calm, never absent), watch under 80%, near below the limit, at it. */
export type StreakTone = "calm" | "watch" | "near" | "at";
export function streakTone(count: number, limit: number): StreakTone {
  if (limit <= 0 || count >= limit) return "at";
  const r = count / limit;
  return r < 0.4 ? "calm" : r < 0.8 ? "watch" : "near";
}

/** `/` search: title, org, id, niche and tags. Matches stay lit; the rest dim. */
export function matchesSearch(gig: Gig, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [gig.title, gig.org ?? "", gig.id, gig.niche ?? "", ...gig.tags].join(" ").toLowerCase().includes(q);
}
