/*
 * The Loom's reading of a cohort (pure; pinned by loomModel.test.ts). Candidates are vertical WARP
 * threads, dimensions are horizontal WEFT rows, every crossing is a knot. This module decides what
 * each thread, row and knot SAYS; loomGeometry.ts decides where it sits; the components only paint.
 *
 * The honesty vocabulary (registry comparative-shortlist-evaluation), as the loom draws it:
 *   clears       the leader's knot is bound with a selvedge stitch; on the overall claim the
 *                leader's whole thread gains a selvedge.
 *   insideNoise  the members whose band reaches the top one are joined by a loose FLOAT: no knot
 *                is bound, the order among them is not a finding.
 *   belowFloor   nothing is drawn but the knots: no float, no stitch, "too few rated".
 *   salary       never a lead (more expensive is not better); its partitions are listed as not
 *                compared, never converted.
 *   absent       no knot: the thread passes behind the row, with its reason (never a 0).
 *   decoy        a SLACK thread (dominated on every compared dimension), its reason on focus.
 *   pending      the thread is still being spun: drawn in place, unfilled, so landing never reflows.
 */
import { COHORT_DIMENSIONS, type AbsentReason, type CellTier, type CohortCell, type CohortDimension, type CohortMember, type CohortView } from "../../cohortTypes.ts";
import { DEFAULT_BAND } from "../../cohortClaims.ts";

export const LOOM_ORDERS = ["neutral", "fit"] as const;
export type LoomOrder = (typeof LOOM_ORDERS)[number];
export const isLoomOrder = (v: unknown): v is LoomOrder => typeof v === "string" && (LOOM_ORDERS as readonly string[]).includes(v);

/** spun = analysed (or reused); pending = queued / analysing; failed = the analysis did not land. */
export type ThreadState = "spun" | "pending" | "failed";

export interface Thread {
  member: CohortMember;
  /** The column it hangs in (0-based, left to right). */
  col: number;
  state: ThreadState;
  /** A decoy: dominated on every compared dimension by `slackBehind`. */
  slack: boolean;
  slackBehind: string | null;
  /** Discussed by the top-N narrative (it continues into the cloth). */
  covered: boolean;
  /** The overall claim clears and this is its leader. */
  selvedge: boolean;
}

export function threadState(m: CohortMember): ThreadState {
  if (m.runState === "failed") return "failed";
  if (m.runState === "queued" || m.runState === "analyzing") return "pending";
  return "spun";
}

/** The hanging order: neutral (the recorded shuffle; encodes no verdict) or fit rank, unrated last. */
export function orderMembers(members: readonly CohortMember[], order: LoomOrder): CohortMember[] {
  const byNeutral = (a: CohortMember, b: CohortMember) => a.neutralIndex - b.neutralIndex;
  if (order === "neutral") return [...members].sort(byNeutral);
  const rank = (m: CohortMember) => m.fitRank ?? Number.POSITIVE_INFINITY;
  return [...members].sort((a, b) => rank(a) - rank(b) || byNeutral(a, b));
}

export function threadsOf(view: CohortView, order: LoomOrder): Thread[] {
  const covers = new Set(view.narrative?.covers ?? []);
  const lead = view.claims.overall.separation === "clears" ? view.claims.overall.leader : null;
  return orderMembers(view.members, order).map((member, col) => ({
    member,
    col,
    state: threadState(member),
    slack: member.decoyOf != null,
    slackBehind: member.decoyOf,
    covered: covers.has(member.memberId),
    selvedge: lead != null && lead === member.memberId,
  }));
}

/* ------------------------------------------------------------------ rows (the weft) */

export type RowReading =
  | { kind: "clears"; leader: string }
  /** `noise` = the top member and every member whose band reaches its floor (>= 2 by construction). */
  | { kind: "insideNoise"; noise: string[] }
  | { kind: "belowFloor" }
  /** Salary: ordered, never crowned; `partitions` when the cohort quotes several currencies. */
  | { kind: "neverLeads"; partitions: Array<{ key: string; count: number }> | null };

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** A rated cell's band (its own, else rating +/- the engine's DEFAULT_BAND), or null when absent. */
export function bandOf(cell: CohortCell): { lo: number; hi: number } | null {
  if (cell.rating == null) return null;
  if (cell.band) return { lo: cell.band.lo, hi: cell.band.hi };
  return { lo: clamp100(cell.rating - DEFAULT_BAND), hi: clamp100(cell.rating + DEFAULT_BAND) };
}

/** The top member on `d` and every member whose band reaches the top band's floor (touching overlaps). */
export function noiseGroup(members: readonly CohortMember[], d: CohortDimension): string[] {
  const rated = members
    .filter((m) => m.cells[d].rating != null)
    .sort((a, b) => (b.cells[d].rating as number) - (a.cells[d].rating as number) || (a.memberId < b.memberId ? -1 : 1));
  if (rated.length === 0) return [];
  const top = bandOf(rated[0].cells[d])!;
  return rated.filter((m) => bandOf(m.cells[d])!.hi >= top.lo).map((m) => m.memberId);
}

export function rowReading(view: CohortView, d: CohortDimension): RowReading {
  const claim = view.claims.byDimension[d];
  if (claim.separation === "belowFloor") return { kind: "belowFloor" };
  if (d === "salary") {
    const parts = claim.partitions && claim.partitions.length > 1 ? claim.partitions.map((p) => ({ key: p.key, count: p.memberIds.length })) : null;
    return { kind: "neverLeads", partitions: parts };
  }
  if (claim.separation === "clears" && claim.leader) return { kind: "clears", leader: claim.leader };
  const noise = noiseGroup(view.members, d);
  // A claim of "insideNoise" with fewer than two rated is not drawable as a float: say belowFloor's words.
  return noise.length >= 2 ? { kind: "insideNoise", noise } : { kind: "belowFloor" };
}

export function rowsOf(view: CohortView): Array<{ dimension: CohortDimension; reading: RowReading; rated: number; note: string | null }> {
  return COHORT_DIMENSIONS.map((dimension) => {
    const claim = view.claims.byDimension[dimension];
    return { dimension, reading: rowReading(view, dimension), rated: claim.rated, note: claim.note ?? null };
  });
}

/* ------------------------------------------------------------------ knots (the crossings) */

/** The mark an absent crossing carries: still spinning, cut, not read, not applicable, kept apart. */
export type AbsentMark = "spinning" | "cut" | "unread" | "na" | "apart";

const ABSENT_MARK: Record<AbsentReason, AbsentMark> = {
  pending: "spinning",
  failed: "cut",
  notRead: "unread",
  notTechnical: "na",
  noLink: "na",
  noJdFit: "na",
  blind: "na",
  currencyMismatch: "apart",
};

export type Knot =
  | { kind: "rated"; tier: Exclude<CellTier, "absent">; rating: number; comment: boolean }
  | { kind: "absent"; reason: AbsentReason; mark: AbsentMark };

export function knotOf(cell: CohortCell): Knot {
  if (cell.tier === "absent" || cell.rating == null) {
    const reason: AbsentReason = cell.absentReason ?? "notRead";
    return { kind: "absent", reason, mark: ABSENT_MARK[reason] };
  }
  return { kind: "rated", tier: cell.tier, rating: cell.rating, comment: cell.comment != null && cell.comment !== "" };
}

/** Does the warp pass BEHIND this row (a visible gap)? A pending thread is drawn whole, unfilled. */
export function passesBehind(cell: CohortCell): boolean {
  return cell.tier === "absent" && cell.absentReason !== "pending";
}

/** How the knot at (member, row) is bound to the row's claim: the leader's stitch, a float, or nothing. */
export function bindingOf(reading: RowReading, memberId: string): "stitch" | "float" | null {
  if (reading.kind === "clears") return reading.leader === memberId ? "stitch" : null;
  if (reading.kind === "insideNoise") return reading.noise.includes(memberId) ? "float" : null;
  return null;
}

/* ------------------------------------------------------------------ the whole loom */

/** Members whose analysis has landed (done or reused), for the run line. */
export function landedCount(view: CohortView): number {
  return view.members.filter((m) => m.runState === "done" || m.runState === "reused").length;
}

/** Fit-rated members, for "rank N of M". */
export function fitRatedCount(view: CohortView): number {
  return view.members.filter((m) => m.cells.fit.rating != null).length;
}

export function memberById(view: CohortView, id: string | null): CohortMember | null {
  if (!id) return null;
  return view.members.find((m) => m.memberId === id) ?? null;
}
