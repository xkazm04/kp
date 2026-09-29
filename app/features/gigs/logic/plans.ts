import { GIG_PLAN_SEATS } from "@/app/_lib/gigs/plan-seats";
import type { GigPlanRow } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// Plans: three seats propose, the operator accepts exactly one (the proof's Plans tab)
// ---------------------------------------------------------------------------
//
// GET /api/gigs/[id]/plans answers every seat's row of every round, newest round first;
// the rows of one round share `createdAt`. These derivations read that list the way the
// tab shows it: the round on screen (the accepted one's, else the newest) in the seat
// lineup's order, the earlier rounds folded under it, whether anything is still being
// written (the tab re-polls until nothing is), and a failed seat's reason as a catalog
// key. Pure: pinned by plans.test.ts.

export type PlanRound = { createdAt: string; rows: GigPlanRow[] };

const SEAT_ORDER: ReadonlyMap<string, number> = new Map(GIG_PLAN_SEATS.map((s, i) => [s.seat, i]));

function bySeat(a: GigPlanRow, b: GigPlanRow): number {
  return (SEAT_ORDER.get(a.seat) ?? 99) - (SEAT_ORDER.get(b.seat) ?? 99);
}

/** The rows folded into rounds, newest first, each round in the lineup's seat order. */
export function planRounds(plans: readonly GigPlanRow[]): PlanRound[] {
  const map = new Map<string, GigPlanRow[]>();
  for (const p of plans) map.set(p.createdAt, [...(map.get(p.createdAt) ?? []), p]);
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([createdAt, rows]) => ({ createdAt, rows: [...rows].sort(bySeat) }));
}

/** The one accepted row (a gig has at most one, ever), or null. */
export function acceptedPlanOf(plans: readonly GigPlanRow[] | null): GigPlanRow | null {
  return plans?.find((p) => p.acceptedAt !== null) ?? null;
}

/** A seat is still being written: the tab keeps polling while any is. */
export function plansBusy(plans: readonly GigPlanRow[] | null): boolean {
  return !!plans && plans.some((p) => p.status === "queued" || p.status === "running");
}

export type PlanView = {
  /** The round the columns show: the accepted plan's, else the newest; null = no plans. */
  shown: PlanRound | null;
  earlier: PlanRound[];
  accepted: GigPlanRow | null;
  /** Plans ready to accept in the shown round. */
  ready: number;
  busy: boolean;
};

export function planView(plans: readonly GigPlanRow[] | null): PlanView {
  const rounds = planRounds(plans ?? []);
  const accepted = acceptedPlanOf(plans);
  const shown = (accepted ? rounds.find((r) => r.createdAt === accepted.createdAt) : null) ?? rounds[0] ?? null;
  return {
    shown,
    earlier: rounds.filter((r) => r !== shown),
    accepted,
    ready: shown ? shown.rows.filter((r) => r.status === "ready" && r.plan !== null).length : 0,
    busy: plansBusy(plans),
  };
}

/** The reasons a seat can fail that the catalog names (`gigs.plans.reason.<key>`); any
 *  other code is shown as itself. `llm_error:<type>` carries its type as the detail. */
export const PLAN_REASON_KEYS = ["no_provider", "llm_unusable", "llm_error", "budget"] as const;
export type PlanReasonKey = (typeof PLAN_REASON_KEYS)[number];

export function planFailure(reason: string | null): { key: PlanReasonKey | null; detail: string | null } {
  if (!reason) return { key: null, detail: null };
  if (reason === "llm_error" || reason.startsWith("llm_error:")) return { key: "llm_error", detail: reason.slice("llm_error:".length) || null };
  return (PLAN_REASON_KEYS as readonly string[]).includes(reason) ? { key: reason as PlanReasonKey, detail: null } : { key: null, detail: reason };
}

/** Wall time as whole minutes and seconds (a seat takes seconds to minutes). */
export function planDuration(ms: number | null): { m: number; s: number } | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  return { m: Math.floor(total / 60), s: total % 60 };
}
