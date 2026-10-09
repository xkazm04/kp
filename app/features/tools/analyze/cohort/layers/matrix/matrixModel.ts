// The Criteria matrix's pure half (spark analyze-v2-cohort round 2, layer `matrix`): which
// candidates stand as columns and in what order, which criteria stand as rows and in what order
// (the role's kind first, then the rows that split the field most), what each row's summary
// says, who the reader is comparing against, how the anatomy sums, and how the keyboard walks the
// grid. CLIENT-SAFE and pure; every rule here is pinned by matrixModel.test.ts.
import { DEFAULT_BAND } from "../../cohortClaims.ts";
import { isTextPhrase } from "../../cohortTypes.ts";
import type {
  CohortDimension,
  CohortMember,
  CohortView,
  CriterionStatus,
  DimensionCriterion,
  MemberDimensionWhy,
  Reason,
  ScoreAnatomy,
} from "../../cohortTypes.ts";
import { byNeutral, pendingOn, ratedOn } from "../../dimensions/dimensionModel.ts";

/** The order the role's criteria are read in: what it requires, then what it aims at, then what was observed. */
export const KIND_ORDER = ["must", "target", "nice", "signal"] as const;
export type CriterionKind = (typeof KIND_ORDER)[number];

/** Which words a status speaks in: a requirement is met or missed, a signal is shown or flagged, a trust check is clear or raised. */
export type Voice = "req" | "signal" | "trust";
export const voiceOf = (d: CohortDimension, kind: CriterionKind): Voice => (d === "trust" ? "trust" : kind === "signal" ? "signal" : "req");

export interface MatrixColumn {
  member: CohortMember;
  /** rated = carries a why on this dimension; pending = its analysis has not landed (drawn unfilled). */
  state: "rated" | "pending";
  rating: number | null;
}

/**
 * The columns, left to right. Rated members by this dimension's rating (ties keep the neutral
 * order: an order, never a lead); salary instead by the stated figure, lowest first, because its
 * rating is band fit and a higher expectation is never a better candidate. Pending members follow
 * in the neutral order, so the grid keeps its width while they land. Absent members are not
 * columns: they stand in the remainder, grouped by reason.
 */
export function matrixColumns(view: CohortView, d: CohortDimension): MatrixColumn[] {
  let rated = ratedOn(view, d).filter((m) => m.why[d] != null);
  if (d === "salary") {
    const fig = (m: CohortMember) => m.detail.salary?.midpoint ?? null;
    rated = [...rated].sort((a, b) => {
      const fa = fig(a);
      const fb = fig(b);
      if (fa == null || fb == null) return fa == null && fb == null ? byNeutral(a, b) : fa == null ? 1 : -1;
      return fa - fb || byNeutral(a, b);
    });
  }
  return [
    ...rated.map((m) => ({ member: m, state: "rated" as const, rating: m.cells[d].rating })),
    ...pendingOn(view, d).map((m) => ({ member: m, state: "pending" as const, rating: null })),
  ];
}

export type Entry = MemberDimensionWhy["criteria"][string];

/** A member's entry for one criterion, or null when they carry no why here (pending). */
export function entryOf(m: CohortMember, d: CohortDimension, criterionId: string): Entry | null {
  const w = m.why[d];
  if (!w) return null;
  return w.criteria[criterionId] ?? { status: "unknown" };
}

export interface RowStats {
  meets: number;
  partial: number;
  misses: number;
  unknown: number;
  /** Members with a why on this dimension (the denominator of every summary). */
  rated: number;
  /** How evenly the row splits the field: Gini impurity over the four statuses, 0 = everyone alike. */
  split: number;
}

export function rowStats(columns: readonly MatrixColumn[], d: CohortDimension, criterionId: string): RowStats {
  const s = { meets: 0, partial: 0, misses: 0, unknown: 0, rated: 0, split: 0 };
  for (const c of columns) {
    const e = entryOf(c.member, d, criterionId);
    if (!e) continue;
    s[e.status] += 1;
    s.rated += 1;
  }
  if (s.rated > 0) {
    const shares = [s.meets, s.partial, s.misses, s.unknown].map((n) => n / s.rated);
    s.split = Math.round((1 - shares.reduce((a, p) => a + p * p, 0)) * 1000) / 1000;
  }
  return s;
}

export interface MatrixRow {
  criterion: DimensionCriterion;
  stats: RowStats;
}
export interface MatrixGroup {
  kind: CriterionKind;
  rows: MatrixRow[];
}

/** Rows grouped by kind (must, target, nice, signal); inside a group the most splitting first, ties in the role's order. */
export function matrixGroups(criteria: readonly DimensionCriterion[], columns: readonly MatrixColumn[], d: CohortDimension): MatrixGroup[] {
  const at = new Map(criteria.map((c, i) => [c.id, i]));
  return KIND_ORDER.map((kind) => ({
    kind,
    rows: criteria
      .filter((c) => c.kind === kind)
      .map((criterion) => ({ criterion, stats: rowStats(columns, d, criterion.id) }))
      .sort((a, b) => b.stats.split - a.stats.split || (at.get(a.criterion.id) ?? 0) - (at.get(b.criterion.id) ?? 0)),
  })).filter((g) => g.rows.length > 0);
}

/** The count a row's summary names, in its voice: requirements meet, signals are seen at all, trust checks are clear. */
export function summaryCount(voice: Voice, s: RowStats): number {
  if (voice === "signal") return s.meets + s.partial + s.misses;
  return s.meets;
}

/**
 * Who the reader is reading and who they read it against. The focus is the focused member's
 * column when it is rated, else the first column; the reference is the first column, or the
 * second when the focus IS the first. Pending columns are never either.
 */
export function readPair(columns: readonly MatrixColumn[], focusId: string | null): { focus: MatrixColumn | null; ref: MatrixColumn | null } {
  const rated = columns.filter((c) => c.state === "rated");
  const focus = rated.find((c) => c.member.memberId === focusId) ?? rated[0] ?? null;
  if (!focus) return { focus: null, ref: null };
  return { focus, ref: focus === rated[0] ? (rated[1] ?? null) : rated[0] };
}

export interface Difference {
  criterion: DimensionCriterion;
  mine: CriterionStatus;
  theirs: CriterionStatus;
}

/** The rows where two members' statuses differ, in the matrix's row order. */
export function differences(groups: readonly MatrixGroup[], d: CohortDimension, a: CohortMember, b: CohortMember): Difference[] {
  const out: Difference[] = [];
  for (const g of groups) {
    for (const { criterion } of g.rows) {
      const mine = entryOf(a, d, criterion.id);
      const theirs = entryOf(b, d, criterion.id);
      if (mine && theirs && mine.status !== theirs.status) out.push({ criterion, mine: mine.status, theirs: theirs.status });
    }
  }
  return out;
}

const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
const bandOf = (m: CohortMember, d: CohortDimension): { lo: number; hi: number } | null => {
  const c = m.cells[d];
  if (c.rating == null) return null;
  return c.band ? { lo: c.band.lo, hi: c.band.hi } : { lo: clamp100(c.rating - DEFAULT_BAND), hi: clamp100(c.rating + DEFAULT_BAND) };
};

/**
 * What the head of the matrix may say about the first columns. A lead only where the claim says
 * the separation clears (the leader's column, by id). Inside the noise: how many leading columns
 * sit within the first one's band (at least two, since the claim says the first two overlap).
 * Below the floor, and always on salary: nothing.
 */
export type HeadClaim = { kind: "clears"; leader: string } | { kind: "noise"; count: number } | null;
export function headClaim(view: CohortView, d: CohortDimension, columns: readonly MatrixColumn[]): HeadClaim {
  if (d === "salary") return null;
  const claim = view.claims.byDimension[d];
  if (claim.separation === "clears" && claim.leader && columns.some((c) => c.member.memberId === claim.leader)) return { kind: "clears", leader: claim.leader };
  if (claim.separation !== "insideNoise") return null;
  const rated = columns.filter((c) => c.state === "rated");
  if (rated.length < 2) return null;
  const top = bandOf(rated[0].member, d);
  let count = 1;
  while (count < rated.length) {
    const b = bandOf(rated[count].member, d);
    if (!top || !b || b.hi < top.lo) break;
    count += 1;
  }
  return { kind: "noise", count: Math.max(2, count) };
}

/** The anatomy as a sum a reader can check: base, each signed part, the raw total, and whether the 0-100 clamp moved it. */
export function anatomySum(a: ScoreAnatomy): { base: number; parts: number[]; raw: number; rating: number; exact: boolean; clamped: boolean } {
  const all = a.parts.map((p) => p.points);
  const raw = a.base + all.reduce((x, y) => x + y, 0);
  // A zero term adds nothing and reads as noise in a one-line sum; the sum stays exact without it.
  return { base: a.base, parts: all.filter((n) => n !== 0), raw, rating: a.rating, exact: raw === a.raw, clamped: a.raw !== a.rating };
}

/**
 * What each reason's points ARE. "part" = an exact term of the anatomy's sum. "forgone" = points
 * the candidate did NOT earn: the engine prices a missing skill, a repo gap or a lost level at what
 * it would have added (e.g. −17) while the anatomy carries it as 0 or not at all, so drawing that
 * figure as a signed term would make the sum read wrong. The phrases of a reason and its anatomy
 * part may differ (experience: "9 years" vs "Experience 25/25"), so the match is by value: each
 * anatomy term is claimed once, pros first, in order. A folded "+N more" sums dropped terms and
 * counts as a part. Reasons without points are absent from the map.
 */
export function pointRoles(w: Pick<MemberDimensionWhy, "pros" | "cons" | "notes" | "anatomy">): Map<Reason, "part" | "forgone"> {
  return pointLedger(w).roles;
}

/**
 * pointRoles plus the anatomy terms NO reason claims (e.g. the half credit of an unproven skill,
 * whose reason is a point-less note): the readout names them beside the sum, so every drawn term
 * has its words. Zero terms are never orphans (they add nothing and are not drawn).
 */
export function pointLedger(w: Pick<MemberDimensionWhy, "pros" | "cons" | "notes" | "anatomy">): {
  roles: Map<Reason, "part" | "forgone">;
  orphans: ScoreAnatomy["parts"];
} {
  const roles = new Map<Reason, "part" | "forgone">();
  const free = w.anatomy ? w.anatomy.parts.map((_, i) => i) : null;
  for (const r of [...w.pros, ...w.cons, ...w.notes]) {
    if (r.points == null) continue;
    if (!free || !w.anatomy || (!isTextPhrase(r.phrase) && r.phrase.key === "more")) {
      roles.set(r, "part");
      continue;
    }
    const parts = w.anatomy.parts;
    const at = r.points === 0 ? -1 : free.findIndex((i) => parts[i].points === r.points);
    if (at >= 0) free.splice(at, 1);
    roles.set(r, at >= 0 ? "part" : "forgone");
  }
  const orphans = free && w.anatomy ? free.map((i) => w.anatomy!.parts[i]).filter((p) => p.points !== 0) : [];
  return { roles, orphans };
}

/** A signed point figure: "+12", "−8" (a true minus), "0". */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

/** A grid position: `row` over the navigable rows (head, criteria…, pros, cons, foot), `col` over the columns. */
export interface Cell {
  row: number;
  col: number;
}

/**
 * One keyboard step inside the matrix. Arrows walk the grid; j / k step to the next / previous
 * candidate (column) on the same row; Home / End jump to the first / last candidate; PageUp /
 * PageDown to the head / foot row. The edges hold (no wrap). Null = not a matrix key.
 */
export function moveCell(at: Cell, key: string, rows: number, cols: number): Cell | null {
  if (rows <= 0 || cols <= 0) return null;
  const clampR = (r: number) => Math.max(0, Math.min(rows - 1, r));
  const clampC = (c: number) => Math.max(0, Math.min(cols - 1, c));
  switch (key) {
    case "ArrowUp":
      return { row: clampR(at.row - 1), col: at.col };
    case "ArrowDown":
      return { row: clampR(at.row + 1), col: at.col };
    case "ArrowLeft":
    case "k":
      return { row: at.row, col: clampC(at.col - 1) };
    case "ArrowRight":
    case "j":
      return { row: at.row, col: clampC(at.col + 1) };
    case "Home":
      return { row: at.row, col: 0 };
    case "End":
      return { row: at.row, col: cols - 1 };
    case "PageUp":
      return { row: 0, col: at.col };
    case "PageDown":
      return { row: rows - 1, col: at.col };
    default:
      return null;
  }
}
