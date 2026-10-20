// The Fit page's band ruler (WP4): every rated member a row with its uncertainty band and its
// point, and the GAP the leader needs drawn as geometry. The geometry is measured the way the
// engine decides the claim (cohortClaims.separationOf: strict, top floor above runner-up
// ceiling), so what the ruler SHOWS and what the claim SAYS cannot disagree.
import type { CohortMember, CohortView, ShortLabel } from "../cohortTypes.ts";
import { absentGroups, pendingOn, type AbsentGroup } from "./dimensionModel.ts";

export interface FitRow {
  member: CohortMember;
  rank: number | null;
  rating: number;
  lo: number;
  hi: number;
  drivers: ShortLabel[];
}

/**
 * clears   = the first row's floor sits above the second row's ceiling: `from` (runner-up hi)
 *            to `to` (leader lo) is open air, `width` points wide.
 * overlap  = the two bands share [from, to]; the order between them is inside the noise.
 * none     = fewer than two rated: there is nothing to separate.
 */
export type FitGap =
  | { kind: "clears"; leaderId: string; runnerId: string; from: number; to: number; width: number }
  | { kind: "overlap"; leaderId: string; runnerId: string; from: number; to: number; width: number }
  | { kind: "none" };

export interface FitModel {
  rows: FitRow[];
  pending: CohortMember[];
  absent: AbsentGroup[];
  /** The ruler's span: a floor rounded down to the tens below the lowest band, up to 100. */
  scale: { min: number; max: number; ticks: number[] };
  gap: FitGap;
}

/** Rated rows in the engine's order: rating desc, ties by memberId (cohortClaims.rankedOn). */
export function fitRows(view: CohortView): FitRow[] {
  return view.members
    .filter((m) => m.cells.fit.rating != null)
    .sort((a, b) => (b.cells.fit.rating as number) - (a.cells.fit.rating as number) || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    .map((m) => {
      const rating = m.cells.fit.rating as number;
      const band = m.cells.fit.band;
      return { member: m, rank: m.fitRank, rating, lo: band?.lo ?? rating, hi: band?.hi ?? rating, drivers: band?.drivers ?? [] };
    });
}

export function fitGap(rows: readonly FitRow[]): FitGap {
  if (rows.length < 2) return { kind: "none" };
  const [top, second] = rows;
  if (top.lo > second.hi) {
    return { kind: "clears", leaderId: top.member.memberId, runnerId: second.member.memberId, from: second.hi, to: top.lo, width: top.lo - second.hi };
  }
  const from = Math.max(top.lo, second.lo);
  const to = Math.min(top.hi, second.hi);
  return { kind: "overlap", leaderId: top.member.memberId, runnerId: second.member.memberId, from, to, width: Math.max(0, to - from) };
}

export function fitScale(rows: readonly FitRow[]): FitModel["scale"] {
  const lowest = rows.reduce((acc, r) => Math.min(acc, r.lo), 100);
  const min = rows.length ? Math.max(0, Math.floor(lowest / 10) * 10) : 0;
  const ticks: number[] = [];
  for (let v = min; v <= 100; v += min <= 50 ? 10 : 5) ticks.push(v);
  return { min, max: 100, ticks };
}

export function fitModel(view: CohortView): FitModel {
  const rows = fitRows(view);
  return { rows, pending: pendingOn(view, "fit"), absent: absentGroups(view, "fit"), scale: fitScale(rows), gap: fitGap(rows) };
}
