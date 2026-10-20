/*
 * The Line-up's street model (pure; pinned by lineupModel.test.ts). Candidates stand side by side as a
 * skyline: the TOWER is overall fit (its height is the rating, its scaffold bracket the band), the six
 * FLOORS below it are the other dimensions (each floor's lit windows are that rating), and the street
 * order is fit rank (unrated at the end) or the neutral order. Every honesty rule of the cohort is
 * decided here, once, from the engine's claims and never re-derived from ratings:
 *   - a rooftop crown only when the overall claim CLEARS; inside the noise the top towers share a haze;
 *   - a floor's lead marker only when that floor's claim clears, and never on salary;
 *   - an absent cell is its own tier (a boarded floor with its reason), never a zero;
 *   - salary partitions are "not comparable", never converted;
 *   - a decoy stands in its dominator's shadow.
 * No React, no DOM: the components read this.
 */
import { COHORT_DIMENSIONS, type AbsentReason, type CohortCell, type CohortDimension, type CohortMember, type CohortView, type Separation } from "../../cohortTypes.ts";
import { DEFAULT_BAND } from "../../cohortClaims.ts";

/** The floors under the tower, top to bottom (the contract's order after fit). */
export const FLOORS = COHORT_DIMENSIONS.filter((d): d is Exclude<CohortDimension, "fit"> => d !== "fit");
/** Every row of a building, top to bottom: the tower, then the floors. */
export const STREET_ROWS: readonly CohortDimension[] = COHORT_DIMENSIONS;

export const STREET_ORDERS = ["fit", "neutral"] as const;
export type StreetOrder = (typeof STREET_ORDERS)[number];
export const isStreetOrder = (v: unknown): v is StreetOrder => typeof v === "string" && (STREET_ORDERS as readonly string[]).includes(v);

/** Windows per floor: each one is 20 rating points, the last one lit in part. */
export const WINDOWS = 5;

/**
 * The street, left to right. `fit`: by fit rank (shared ranks keep the neutral order between them),
 * members without a fit rating at the end in neutral order. `neutral`: the recorded neutral order,
 * which encodes no verdict. Never mutates the view.
 */
export function streetOrder(members: readonly CohortMember[], order: StreetOrder): CohortMember[] {
  const byNeutral = (a: CohortMember, b: CohortMember) => a.neutralIndex - b.neutralIndex;
  if (order === "neutral") return [...members].sort(byNeutral);
  const rank = (m: CohortMember) => m.fitRank ?? Number.POSITIVE_INFINITY;
  return [...members].sort((a, b) => rank(a) - rank(b) || byNeutral(a, b));
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** A rated cell's band: its own when it carries one, else the engine's default half-width. */
export function cellBand(cell: CohortCell): { lo: number; hi: number } | null {
  if (cell.rating == null) return null;
  if (cell.band) return { lo: cell.band.lo, hi: cell.band.hi };
  return { lo: clamp100(cell.rating - DEFAULT_BAND), hi: clamp100(cell.rating + DEFAULT_BAND) };
}

/** How much of a floor is lit, 0..1 (the rating over 100); null when the floor is boarded. */
export const litShare = (cell: CohortCell): number | null => (cell.rating == null ? null : clamp100(cell.rating) / 100);

/** What a floor or a tower IS, before any paint: rated, boarded with a reason, or under construction. */
export type Lot = { kind: "rated"; rating: number } | { kind: "boarded"; reason: AbsentReason } | { kind: "building" };
export function lotOf(cell: CohortCell): Lot {
  if (cell.rating != null) return { kind: "rated", rating: cell.rating };
  const reason = cell.absentReason ?? "notRead";
  return reason === "pending" ? { kind: "building" } : { kind: "boarded", reason };
}

/** The leader whose rooftop wears the crown: ONLY when the overall claim clears. */
export function crownOf(view: CohortView): string | null {
  const o = view.claims.overall;
  return o.separation === "clears" ? o.leader : null;
}

/** The floor's lead marker: only a clearing claim names one, and salary never does. */
export function floorLeaderOf(view: CohortView, d: CohortDimension): string | null {
  if (d === "salary") return null;
  const c = view.claims.byDimension[d];
  return c.separation === "clears" ? c.leader : null;
}

/**
 * The haze over the top of the street when the overall order is NOT a lead: the first tower by fit
 * and every tower whose band reaches into its band (inclusive: touching bands overlap). The haze
 * spans the first tower's band floor to the highest ceiling among them. Null when the claim clears
 * (the crown speaks instead) or is below the floor (no comparative claim at all).
 */
export type Haze = { lo: number; hi: number; memberIds: string[] };
export function hazeOf(view: CohortView): Haze | null {
  if (view.claims.overall.separation !== "insideNoise") return null;
  const rated = view.members
    .filter((m) => m.cells.fit.rating != null)
    .sort((a, b) => (b.cells.fit.rating as number) - (a.cells.fit.rating as number) || (a.memberId < b.memberId ? -1 : 1));
  const top = rated[0] ? cellBand(rated[0].cells.fit) : null;
  if (!top) return null;
  const group = rated.filter((m) => (cellBand(m.cells.fit)?.hi ?? -1) >= top.lo);
  const hi = Math.max(...group.map((m) => cellBand(m.cells.fit)?.hi ?? top.hi));
  return { lo: top.lo, hi, memberIds: group.map((m) => m.memberId) };
}

/** A floor's claim as the directory states it. `partitioned` = salary split by currency, never converted. */
export type FloorClaimTone = Separation | "partitioned";
export type FloorClaim = { tone: FloorClaimTone; leader: string | null; rated: number; partitions: number };
export function floorClaimOf(view: CohortView, d: CohortDimension): FloorClaim {
  const c = view.claims.byDimension[d];
  const partitions = c.partitions?.length ?? 0;
  const tone: FloorClaimTone = d === "salary" && partitions > 1 && c.separation !== "belowFloor" ? "partitioned" : c.separation;
  return { tone, leader: floorLeaderOf(view, d), rated: c.rated, partitions };
}

/**
 * A member's salary partition when the cohort quotes several: its key, and whether it is the
 * largest line (the one the floor's order reads). Null when salary is not partitioned or the
 * member quoted nothing.
 */
export function salaryLineOf(view: CohortView, memberId: string): { key: string; main: boolean } | null {
  const parts = view.claims.byDimension.salary.partitions;
  if (!parts || parts.length < 2) return null;
  const at = parts.findIndex((p) => p.memberIds.includes(memberId));
  return at < 0 ? null : { key: parts[at].key, main: at === 0 };
}

/** The walk-through's stops: 1-based position in the narrative for every member it covers. */
export function tourStops(view: CohortView): Map<string, number> {
  return new Map((view.narrative?.covers ?? []).map((id, i) => [id, i + 1] as const));
}

/** Does another member share this one's fit rank (a tie the house number must not hide)? */
export function sharesRank(view: CohortView, m: CohortMember): boolean {
  return m.fitRank != null && view.members.some((o) => o.memberId !== m.memberId && o.fitRank === m.fitRank);
}

/** Counts for the street's construction line (a running cohort). */
export function siteCounts(view: CohortView): { built: number; building: number; failed: number } {
  let built = 0;
  let building = 0;
  let failed = 0;
  for (const m of view.members) {
    if (m.runState === "failed") failed++;
    else if (m.runState === "done" || m.runState === "reused") built++;
    else building++;
  }
  return { built, building, failed };
}

/**
 * The decoy's shadow as an arc over the street: from the dominator's roof to the decoy's, in street
 * units (column centres at i + 0.5; heights 0..100 as fit). Null when either is not on the street.
 */
export function shadowArc(order: readonly CohortMember[], decoyId: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const i = order.findIndex((m) => m.memberId === decoyId);
  const decoy = order[i];
  if (!decoy?.decoyOf) return null;
  const j = order.findIndex((m) => m.memberId === decoy.decoyOf);
  if (j < 0) return null;
  return { x1: j + 0.5, y1: order[j].cells.fit.rating ?? 0, x2: i + 0.5, y2: decoy.cells.fit.rating ?? 0 };
}

/** One step through the dimensions (a floor up or down), wrapping at the roof and the street. */
export function stepDimension(d: CohortDimension, delta: 1 | -1): CohortDimension {
  const i = STREET_ROWS.indexOf(d);
  const n = STREET_ROWS.length;
  return STREET_ROWS[(i + delta + n) % n];
}
