// The Verdict ledger's pure half (spark analyze-v2-cohort round 2, structure `ledger`): which rows
// the ledger holds and in what order, what each row may CLAIM about its position (a rank, a lead
// that clears, a first place inside the noise, a salary order that is never a rank), which reasons a
// row shows before "+N more", the role's must-have misses, the anatomy read as an exact sum, and the
// criteria tally. CLIENT-SAFE and pure; every rule is pinned by ledgerModel.test.ts.
import type {
  CellTier,
  CohortDimension,
  CohortMember,
  CohortView,
  CriterionStatus,
  DimensionCriterion,
  MemberDimensionWhy,
  Phrase,
  Reason,
  ScoreAnatomy,
} from "../../cohortTypes.ts";
import { absentGroups, pendingOn, ratedOn, type AbsentGroup } from "../../dimensions/dimensionModel.ts";

/** How many pros / cons a row shows before it folds the rest into "+N more". */
export const LEDGER_SHOWN = 3;

export const LEDGER_FILTERS = ["all", "cons", "mustMiss"] as const;
export type LedgerFilter = (typeof LEDGER_FILTERS)[number];
export const isLedgerFilter = (v: unknown): v is LedgerFilter => typeof v === "string" && (LEDGER_FILTERS as readonly string[]).includes(v);

/**
 * What the position column may say. `rank` = an ordering on a compared dimension; `order` = an
 * ordering that is never a rank (salary: a higher expectation is not a better candidate; below the
 * floor: nothing is compared).
 */
export type PositionKind = "rank" | "order";

export interface LedgerRow {
  member: CohortMember;
  /** 1-based competition position (equal ratings share it: 1, 1, 3). */
  position: number;
  /** Another row carries the same rating. */
  tied: boolean;
  rating: number;
  tier: Exclude<CellTier, "absent">;
  why: MemberDimensionWhy;
  /** This row leads AND the gap clears the bands (the only crown the ledger draws). */
  lead: boolean;
  /** This row sits within the first row's noise (bands overlap, or the same rating where no band exists). */
  noise: boolean;
  /** Points below the first row; null on the first row and wherever no rank is claimed. */
  gap: number | null;
}

export interface Ledger {
  positionKind: PositionKind;
  rows: LedgerRow[];
  pending: CohortMember[];
  absent: AbsentGroup[];
}

const overlaps = (a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean => a.lo <= b.hi && b.lo <= a.hi;

/** The ledger of one dimension: rated rows best first (salary: by figure; neutral order on ties), then pending, then absent by reason. */
export function buildLedger(view: CohortView, d: CohortDimension): Ledger {
  const claim = view.claims.byDimension[d];
  const positionKind: PositionKind = d === "salary" || claim.separation === "belowFloor" ? "order" : "rank";
  // A rated cell without its why cannot explain itself; the engine pairs them, this keeps the row honest if not.
  // Salary follows the claim strip's words ("ordered by figure, never ranked"): highest expectation
  // first, the band-fit rating shown but not sorted on. Every other dimension orders by its rating.
  const key = (m: CohortMember): number => (d === "salary" ? (m.detail.salary?.midpoint ?? m.cells[d].rating ?? 0) : (m.cells[d].rating as number));
  const rated = ratedOn(view, d)
    .filter((m) => m.why[d] != null)
    .sort((a, b) => key(b) - key(a) || a.neutralIndex - b.neutralIndex);
  const top = rated[0];
  const rows: LedgerRow[] = rated.map((m, i) => {
    const cell = m.cells[d];
    const rating = cell.rating as number;
    const first = rated.findIndex((o) => key(o) === key(m));
    const tied = rated.some((o, j) => j !== i && key(o) === key(m));
    const topCell = top.cells[d];
    const noise =
      claim.separation === "insideNoise" && positionKind === "rank"
        ? cell.band && topCell.band
          ? overlaps(cell.band, topCell.band)
          : rating === topCell.rating
        : false;
    return {
      member: m,
      position: first + 1,
      tied,
      rating,
      tier: cell.tier as LedgerRow["tier"],
      why: m.why[d] as MemberDimensionWhy,
      lead: positionKind === "rank" && claim.separation === "clears" && claim.leader === m.memberId,
      noise,
      gap: positionKind === "rank" && i > 0 ? (topCell.rating as number) - rating : null,
    };
  });
  return { positionKind, rows, pending: pendingOn(view, d), absent: absentGroups(view, d) };
}

/** The engine's fold of the reasons past its cap ("+N more"). */
export const isFolded = (r: Reason): boolean => "key" in r.phrase && r.phrase.key === "more";
/** A folded reason stands for N reasons; any other reason for one. */
export const reasonWeight = (r: Reason): number => ("key" in r.phrase && isFolded(r) ? Number(r.phrase.params?.n ?? 1) : 1);

/**
 * The head of a reason list and how many reasons it leaves out. One left-over reason is shown rather
 * than folded ("+1 more" costs the line it would save); a folded engine reason counts as its N.
 */
export function headOf(list: readonly Reason[], n: number = LEDGER_SHOWN): { items: Reason[]; more: number } {
  if (list.length <= n + 1) return { items: [...list], more: 0 };
  const items = list.slice(0, n);
  return { items, more: list.slice(n).reduce((s, r) => s + reasonWeight(r), 0) };
}

/** A phrase's identity: the same prose, or the same key with the same values (order-free). */
export function phraseId(p: Phrase): string {
  if ("text" in p) return `t:${p.text.trim()}`;
  const params = Object.entries(p.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return `k:${p.key}:${JSON.stringify(params)}`;
}

/**
 * What a row says that the first row does NOT: the reasons it shares with the first row fold into one
 * count (with their points summed where they carry any), so twenty lines of "Java shown on the CV" stop
 * hiding the two lines that make the difference. The first row itself, and any ledger that claims no
 * rank (salary, below the floor), keep their lists whole.
 */
export function splitShared(list: readonly Reason[], first: readonly Reason[] | null): { distinct: Reason[]; shared: number; sharedPoints: number | null } {
  if (!first) return { distinct: [...list], shared: 0, sharedPoints: null };
  const firstIds = new Set(first.filter((r) => !isFolded(r)).map((r) => phraseId(r.phrase)));
  const distinct: Reason[] = [];
  let shared = 0;
  let pts: number | null = null;
  for (const r of list) {
    if (!isFolded(r) && firstIds.has(phraseId(r.phrase))) {
      shared += 1;
      if (r.points !== undefined) pts = (pts ?? 0) + r.points;
    } else distinct.push(r);
  }
  return { distinct, shared, sharedPoints: pts };
}

/** The role's must-have criteria this member misses on this dimension, in the role's order. */
export function mustMisses(criteria: readonly DimensionCriterion[], why: MemberDimensionWhy): DimensionCriterion[] {
  return criteria.filter((c) => c.kind === "must" && why.criteria[c.id]?.status === "misses");
}

/** A dimension offers the must-miss filter only when the role states must-haves on it. */
export const hasMusts = (criteria: readonly DimensionCriterion[]): boolean => criteria.some((c) => c.kind === "must");

/** The rows a filter keeps: must-miss keeps only rows missing a must-have; the others keep every row. */
export function filterRows(rows: readonly LedgerRow[], filter: LedgerFilter, criteria: readonly DimensionCriterion[]): LedgerRow[] {
  if (filter !== "mustMiss") return [...rows];
  return rows.filter((r) => mustMisses(criteria, r.why).length > 0);
}

/**
 * The cons a row shows under a filter: under must-miss, the reasons that speak to a missed must-have
 * come first (a missed must-have with no reason of its own is still named, as its criterion's phrase).
 */
export function consFor(row: LedgerRow, filter: LedgerFilter, criteria: readonly DimensionCriterion[], d: CohortDimension): Reason[] {
  if (filter !== "mustMiss") return row.why.cons;
  const missed = mustMisses(criteria, row.why);
  const ids = new Set(missed.map((c) => c.id));
  const spoken = row.why.cons.filter((r) => r.criterionId && ids.has(r.criterionId));
  const said = new Set(spoken.map((r) => r.criterionId));
  const silent: Reason[] = missed.filter((c) => !said.has(c.id)).map((c) => ({ tone: "con", phrase: c.phrase, source: d === "publicWork" ? "github" : "skills", criterionId: c.id }));
  return [...spoken, ...silent];
}

/** The anatomy as an exact sum: every term, and whether the 0-100 clamp moved the raw total. */
export interface AnatomySum {
  base: number;
  terms: Array<{ phrase: Phrase; points: number; tone: Reason["tone"] }>;
  raw: number;
  rating: number;
  clamped: boolean;
  /** base + sum(terms) === raw: the engine's promise, re-checked rather than trusted. */
  exact: boolean;
}

export function anatomySum(a: ScoreAnatomy): AnatomySum {
  const total = a.base + a.parts.reduce((s, p) => s + p.points, 0);
  return { base: a.base, terms: a.parts, raw: a.raw, rating: a.rating, clamped: a.raw !== a.rating, exact: total === a.raw };
}

/** "+17", "−6", "±0": a signed rating-point figure (U+2212 minus, so it never reads as a hyphen). */
export function signed(points: number): string {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return "±0";
}

/** How many criteria this member meets, half-meets, misses, or was never read on. */
export function criteriaTally(why: MemberDimensionWhy): Record<CriterionStatus, number> {
  const out: Record<CriterionStatus, number> = { meets: 0, partial: 0, misses: 0, unknown: 0 };
  for (const c of Object.values(why.criteria)) out[c.status] += 1;
  return out;
}
