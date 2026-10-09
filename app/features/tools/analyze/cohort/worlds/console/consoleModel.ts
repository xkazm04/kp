/*
 * The Console world's model (pure; pinned by consoleModel.test.ts).
 *
 * A cohort read as a mixing desk: every member is a CHANNEL STRIP, every dimension a BUS that runs
 * across the strips. Six buses are segment meters; overall fit is the channel FADER at the foot of
 * each strip. This module decides what the desk may say and nothing about how it is drawn:
 *   - which strips are patched in which order (neutral by default: an ordering is not a lead, and
 *     a neutral patch does not reflow when a running cohort's members land);
 *   - how many segments a rating lights (a rated 0 lights none and is still a rating; an absent
 *     cell is `null`, a capped meter, never 0);
 *   - what each bus may claim (a lead only where the code-decided claim says "clears"; salary never);
 *   - the noise group on the faders (the members whose fit band overlaps the top one's), the trust
 *     lamps (peak = a warning, clip = a blocker, null = not read), and the absent tally per bus.
 */
import type { AbsentReason, CohortDimension, CohortMember, CohortView } from "../../cohortTypes.ts";

/** The buses top to bottom, as the desk draws them: six meters, then the fader (overall fit). */
export const BUS_ORDER = ["skills", "experience", "signals", "trust", "salary", "publicWork", "fit"] as const satisfies readonly CohortDimension[];
export type Bus = (typeof BUS_ORDER)[number];
export const FADER_BUS: Bus = "fit";
/** Segments in one meter: each lights for ten points. */
export const SEGMENTS = 10;

export const PATCH_ORDERS = ["neutral", "fit"] as const;
export type PatchOrder = (typeof PATCH_ORDERS)[number];
export const isPatchOrder = (v: unknown): v is PatchOrder => typeof v === "string" && (PATCH_ORDERS as readonly string[]).includes(v);

/**
 * The strips in patch order. `neutral` = the cohort's stable presentation shuffle (the default);
 * `fit` = fit rank, the unrated at the end in neutral order. Never mutates the view.
 */
export function patchOrder(members: readonly CohortMember[], order: PatchOrder): CohortMember[] {
  const byNeutral = (a: CohortMember, b: CohortMember) => a.neutralIndex - b.neutralIndex;
  if (order === "neutral") return [...members].sort(byNeutral);
  return [...members].sort((a, b) => {
    if (a.fitRank != null && b.fitRank != null && a.fitRank !== b.fitRank) return a.fitRank - b.fitRank;
    if (a.fitRank == null && b.fitRank != null) return 1;
    if (a.fitRank != null && b.fitRank == null) return -1;
    return byNeutral(a, b);
  });
}

/** Lit segments for a rating: 0..SEGMENTS, or null when there is no rating (the meter is capped). */
export function litSegments(rating: number | null): number | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  return Math.max(0, Math.min(SEGMENTS, Math.round(rating / (100 / SEGMENTS))));
}

/** A 0-100 value as a fraction of the fader's travel, clamped. */
export const travel = (v: number): number => Math.max(0, Math.min(1, v / 100));

/** What a strip is as a whole: live (its analysis landed), pending (queued / analyzing), failed. */
export type StripState = "live" | "pending" | "failed";
export function stripState(m: CohortMember): StripState {
  if (m.runState === "failed") return "failed";
  if (m.runState === "queued" || m.runState === "analyzing") return "pending";
  return "live";
}

/** The trust lamps: peak = a warning, clip = a blocker. `null` = the trust read is absent (unlit, not "clean"). */
export function trustLamps(m: CohortMember): { peak: boolean; clip: boolean } | null {
  const trust = m.detail.trust;
  if (!trust || m.cells.trust.tier === "absent") return null;
  return {
    peak: trust.findings.some((f) => f.severity === "warn"),
    clip: trust.findings.some((f) => f.severity === "blocker"),
  };
}

/** What one bus may say. `lead` names a member only on "clears"; salary is never ranked. */
export type BusClaim =
  | { kind: "lead"; leader: string }
  | { kind: "noise" }
  | { kind: "floor" }
  | { kind: "unranked"; partitions: number };

export function busClaim(view: CohortView, dim: CohortDimension): BusClaim {
  const c = view.claims.byDimension[dim];
  if (dim === "salary") return { kind: "unranked", partitions: c?.partitions?.length ?? 0 };
  if (!c || c.separation === "belowFloor") return { kind: "floor" };
  if (c.separation === "clears" && c.leader) return { kind: "lead", leader: c.leader };
  return { kind: "noise" };
}

/** The member a bus names as its leader, else null (salary: always null). */
export function busLeader(view: CohortView, dim: CohortDimension): string | null {
  const claim = busClaim(view, dim);
  return claim.kind === "lead" ? claim.leader : null;
}

/** The overall claim, as the master section reads it. */
export type MasterClaim = { kind: "lead"; leader: string } | { kind: "noise" } | { kind: "floor" };
export function masterClaim(view: CohortView): MasterClaim {
  const o = view.claims.overall;
  if (o.separation === "clears" && o.leader) return { kind: "lead", leader: o.leader };
  if (o.separation === "belowFloor") return { kind: "floor" };
  return { kind: "noise" };
}

/**
 * The fader noise group: when the overall claim is "insideNoise", the members whose fit band
 * overlaps the band of the member ranked first, and the span those bands cover. A member without a
 * band counts as the point of its rating. Null when the claim is not "insideNoise" or nothing is rated.
 */
export function noiseGroup(view: CohortView): { ids: string[]; lo: number; hi: number } | null {
  if (view.claims.overall.separation !== "insideNoise") return null;
  const span = (m: CohortMember): [number, number] | null => {
    const c = m.cells.fit;
    if (c.rating == null) return null;
    return c.band ? [c.band.lo, c.band.hi] : [c.rating, c.rating];
  };
  const top = view.members.filter((m) => m.fitRank != null).sort((a, b) => (a.fitRank ?? 0) - (b.fitRank ?? 0))[0];
  const topSpan = top ? span(top) : null;
  if (!top || !topSpan) return null;
  const ids: string[] = [];
  let lo = topSpan[0];
  let hi = topSpan[1];
  for (const m of view.members) {
    const s = span(m);
    if (!s || s[1] < topSpan[0] || s[0] > topSpan[1]) continue;
    ids.push(m.memberId);
    lo = Math.min(lo, s[0]);
    hi = Math.max(hi, s[1]);
  }
  return { ids, lo, hi };
}

/** Absent cells on one bus, by reason, most frequent first (ties in ABSENT_REASONS order of first sight). */
export function absentTally(view: CohortView, dim: CohortDimension): Array<{ reason: AbsentReason; n: number }> {
  const counts = new Map<AbsentReason, number>();
  for (const m of view.members) {
    const c = m.cells[dim];
    if (c.tier === "absent" && c.absentReason) counts.set(c.absentReason, (counts.get(c.absentReason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n);
}

/** The label of a member id (the decoy's dominator, a named leader), or null for an unknown id. */
export function labelOf(view: CohortView, memberId: string | null): string | null {
  if (!memberId) return null;
  return view.members.find((m) => m.memberId === memberId)?.label ?? null;
}

/** A member has at least one rare model comment on any bus. */
export const hasComment = (m: CohortMember): boolean => Object.values(m.cells).some((c) => typeof c.comment === "string" && c.comment.length > 0);
