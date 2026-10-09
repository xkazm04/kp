// The head-to-head structure's pure half (spark analyze-v2-cohort, round 2): who stands in the
// head-to-head, how the role's criteria line up across them (where they DIFFER first, where they
// agree folded by the status they share), which pros and cons sit outside the criteria (shared
// ones aligned, the rest each candidate's own), how a formula rating was built, and the field
// the picker lists. CLIENT-SAFE and pure; every rule is pinned by headToHeadModel.test.ts.
import { isTextPhrase } from "../../cohortTypes.ts";
import type {
  CohortDimension,
  CohortMember,
  CohortView,
  CriterionStatus,
  DimensionCriterion,
  MemberDimensionWhy,
  Phrase,
  Reason,
} from "../../cohortTypes.ts";
import { absentGroups, byNeutral, pendingOn, ratedOn, ratingOf, type AbsentGroup } from "../../dimensions/dimensionModel.ts";

/** The most candidates one head-to-head holds; beyond it the columns stop reading side by side. */
export const H2H_MAX = 4;
/** Criteria order: what the role requires first, what is merely observed last. */
export const KIND_ORDER: readonly DimensionCriterion["kind"][] = ["must", "target", "nice", "signal"];
/** Agreeing rows fold by the status they share, in this order. */
export const STATUS_ORDER: readonly CriterionStatus[] = ["meets", "partial", "misses", "unknown"];

const memberOf = (view: CohortView, id: string): CohortMember | undefined => view.members.find((m) => m.memberId === id);

/**
 * The rivals a head-to-head opens with, the focused member excluded (it has its own column): the
 * strongest rated on THIS dimension, then the strongest whose rating differs from every rating
 * already on the board, so the opening board always shows a difference to explain (a tie at the
 * top beside a focus that shares it would show three identical corners). Two beside a focus,
 * three without one; when nobody differs, the next strongest.
 */
export function defaultRivals(view: CohortView, d: CohortDimension, focusId: string | null): string[] {
  const focus = focusId ? memberOf(view, focusId) : undefined;
  const want = focus ? 2 : 3;
  const pool = ratedOn(view, d).filter((m) => m.memberId !== focus?.memberId);
  const out: CohortMember[] = [];
  const seen = new Set<number | null>(focus ? [ratingOf(focus, d)] : []);
  for (const m of pool) {
    if (out.length >= want) break;
    if (out.length === 0 || !seen.has(ratingOf(m, d))) {
      out.push(m);
      seen.add(ratingOf(m, d));
    }
  }
  for (const m of pool) if (out.length < want && !out.includes(m)) out.push(m);
  return out.map((m) => m.memberId);
}

/**
 * The columns, left to right: the focused member first (it stays put while j/k walks the field),
 * then the rivals by this dimension's rating (unrated last, neutral tie-break), at most H2H_MAX.
 */
export function columnsOf(view: CohortView, d: CohortDimension, focusId: string | null, rivals: readonly string[]): CohortMember[] {
  const subject = focusId ? memberOf(view, focusId) : undefined;
  const rest = [...new Set(rivals)]
    .filter((id) => id !== subject?.memberId)
    .map((id) => memberOf(view, id))
    .filter((m): m is CohortMember => !!m)
    .sort((a, b) => (ratingOf(b, d) ?? -1) - (ratingOf(a, d) ?? -1) || byNeutral(a, b));
  return [...(subject ? [subject] : []), ...rest].slice(0, H2H_MAX);
}

/** Press a rival's pin: out if it is in, in if there is room, unchanged when the board is full. */
export function toggleRival(rivals: readonly string[], id: string, columnCount: number): string[] {
  if (rivals.includes(id)) return rivals.filter((r) => r !== id);
  return columnCount >= H2H_MAX ? [...rivals] : [...rivals, id];
}

// ---- the criteria, aligned --------------------------------------------------------

export interface CriterionCell {
  memberId: string;
  /** null = this member has no reading on the dimension at all (the column says why). */
  status: CriterionStatus | null;
  /** The member's reasons that speak to this criterion (pros, cons, notes, in that order). */
  reasons: Reason[];
  note: Phrase | null;
}
export interface CriterionRow {
  criterion: DimensionCriterion;
  cells: CriterionCell[];
  differs: boolean;
}
export interface AgreeGroup {
  status: CriterionStatus;
  rows: CriterionRow[];
}

const whyOf = (m: CohortMember, d: CohortDimension): MemberDimensionWhy | null => m.why[d] ?? null;

/** A phrase's identity, its words only: a text phrase by its text, a key phrase by key + params. */
export function phraseKey(p: Phrase): string {
  if (isTextPhrase(p)) return `t:${p.text.trim().toLowerCase()}`;
  const params = Object.entries(p.params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return `k:${p.key}:${JSON.stringify(params)}`;
}

/**
 * A reason without points whose words are an anatomy part (an unproven skill's half credit) takes
 * the part's points: the anatomy is the exact decomposition, so the reader sees where every point
 * of the rating came from. A reason that already carries points keeps its own.
 */
export function withPartPoints(w: MemberDimensionWhy, r: Reason): Reason {
  if (r.points !== undefined || !w.anatomy) return r;
  const part = w.anatomy.parts.find((p) => phraseKey(p.phrase) === phraseKey(r.phrase));
  return part ? { ...r, points: part.points } : r;
}

const allReasons = (w: MemberDimensionWhy): Reason[] => [...w.pros, ...w.cons, ...w.notes].map((r) => withPartPoints(w, r));

/** The role's criteria for a dimension, required first (stable within a kind). */
export function orderedCriteria(view: CohortView, d: CohortDimension): DimensionCriterion[] {
  return [...(view.criteria[d] ?? [])].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/**
 * Every criterion as a row across the columns. A row DIFFERS when the columns that carry a
 * reading do not share one status. With fewer than two readings nothing is compared, so every
 * row stays open and none folds.
 */
export function alignCriteria(view: CohortView, d: CohortDimension, cols: readonly CohortMember[]): { open: CriterionRow[]; agree: AgreeGroup[] } {
  const read = cols.filter((m) => whyOf(m, d)).length;
  const rows = orderedCriteria(view, d).map((criterion): CriterionRow => {
    const cells = cols.map((m): CriterionCell => {
      const w = whyOf(m, d);
      if (!w) return { memberId: m.memberId, status: null, reasons: [], note: null };
      const c = w.criteria[criterion.id];
      return { memberId: m.memberId, status: c?.status ?? "unknown", reasons: allReasons(w).filter((r) => r.criterionId === criterion.id), note: c?.note ?? null };
    });
    const statuses = new Set(cells.map((c) => c.status).filter((s): s is CriterionStatus => s != null));
    return { criterion, cells, differs: statuses.size > 1 };
  });
  if (read < 2) return { open: rows, agree: [] };
  const agree = STATUS_ORDER.map((status) => ({
    status,
    rows: rows.filter((r) => !r.differs && r.cells.some((c) => c.status === status)),
  })).filter((g) => g.rows.length > 0);
  return { open: rows.filter((r) => r.differs), agree };
}

// ---- the reasons outside the criteria ------------------------------------------------

/** A reason's identity across candidates: its tone and its words (never its points). */
export function reasonKey(r: Reason): string {
  return `${r.tone}|${phraseKey(r.phrase)}`;
}

export interface SharedReason {
  key: string;
  tone: Reason["tone"];
  phrase: Phrase;
  /** One slot per column: the member's own copy (its points), or null when it is not theirs. */
  cells: (Reason | null)[];
  /** Every column with a reading holds it: agreement, folded like an agreeing criterion. */
  all: boolean;
}
export interface OwnReasons {
  memberId: string;
  pros: Reason[];
  cons: Reason[];
  notes: Reason[];
}

/**
 * The pros, cons and notes that map onto no criterion of this dimension. A reason two or more
 * columns hold (same tone, same words) becomes one aligned row; the rest stay each column's own.
 * The "+N more" fold is never shared: two folds of equal size are not the same reasons.
 */
export function alignLoose(view: CohortView, d: CohortDimension, cols: readonly CohortMember[]): { shared: SharedReason[]; own: OwnReasons[] } {
  const ids = new Set((view.criteria[d] ?? []).map((c) => c.id));
  const loose = cols.map((m) => {
    const w = whyOf(m, d);
    return w ? allReasons(w).filter((r) => !r.criterionId || !ids.has(r.criterionId)) : [];
  });
  const count = new Map<string, number>();
  for (const list of loose) for (const k of new Set(list.map(reasonKey))) count.set(k, (count.get(k) ?? 0) + 1);
  const isShared = (r: Reason) => !(!isTextPhrase(r.phrase) && r.phrase.key === "more") && (count.get(reasonKey(r)) ?? 0) >= 2;
  const shared = new Map<string, SharedReason>();
  loose.forEach((list, i) => {
    for (const r of list.filter(isShared)) {
      const k = reasonKey(r);
      const row = shared.get(k) ?? { key: k, tone: r.tone, phrase: r.phrase, cells: cols.map(() => null), all: false };
      row.cells[i] = row.cells[i] ?? r;
      shared.set(k, row);
    }
  });
  const reading = cols.map((m) => whyOf(m, d) != null);
  for (const row of shared.values()) row.all = row.cells.every((c, i) => c != null || !reading[i]);
  const toneAt = (t: Reason["tone"]) => (t === "pro" ? 0 : t === "con" ? 1 : 2);
  const sharedRows = [...shared.values()].sort(
    (a, b) => toneAt(a.tone) - toneAt(b.tone) || b.cells.filter(Boolean).length - a.cells.filter(Boolean).length
  );
  const own = cols.map((m, i): OwnReasons => {
    const mine = loose[i].filter((r) => !isShared(r));
    return { memberId: m.memberId, pros: mine.filter((r) => r.tone === "pro"), cons: mine.filter((r) => r.tone === "con"), notes: mine.filter((r) => r.tone === "note") };
  });
  return { shared: sharedRows, own };
}

// ---- how the rating was built --------------------------------------------------------

export type Built =
  | { kind: "model" }
  | { kind: "none" }
  | { kind: "sum"; base: number; earned: number; lost: number; raw: number; rating: number; clamped: boolean };

/**
 * The anatomy as one line: base, what the parts earned, what they cost, the result. Fit is the
 * model's own number (no breakdown, said plainly); an absent reading has nothing to build.
 * base + earned - lost === raw by the engine's apportionment; clamped says the rating was held.
 */
export function builtOf(m: CohortMember, d: CohortDimension): Built {
  if (d === "fit") return { kind: "model" };
  const a = whyOf(m, d)?.anatomy;
  if (!a) return { kind: "none" };
  const earned = a.parts.filter((p) => p.points > 0).reduce((s, p) => s + p.points, 0);
  const lost = a.parts.filter((p) => p.points < 0).reduce((s, p) => s - p.points, 0);
  return { kind: "sum", base: a.base, earned, lost, raw: a.raw, rating: a.rating, clamped: a.raw !== a.rating };
}

// ---- a column against the first ------------------------------------------------------

export interface Delta {
  /** b's rating minus a's, in rating points. */
  delta: number;
  /** clears = the two uncertainty bands do not touch; overlaps = they do; null = no bands to say. */
  gap: "clears" | "overlaps" | null;
}

/** How column `b` stands against column `a` on this dimension; null when either is unrated. */
export function deltaOf(a: CohortMember, b: CohortMember, d: CohortDimension): Delta | null {
  const ra = ratingOf(a, d);
  const rb = ratingOf(b, d);
  if (ra == null || rb == null) return null;
  const ba = a.cells[d].band;
  const bb = b.cells[d].band;
  const gap = ba && bb ? (ba.lo <= bb.hi && bb.lo <= ba.hi ? "overlaps" : "clears") : null;
  return { delta: rb - ra, gap };
}

// ---- the field (the picker) ----------------------------------------------------------

export interface FieldRow {
  member: CohortMember;
  /** Competition rank on this dimension (equal ratings share a rank); an order, never a lead. */
  rank: number;
  tied: boolean;
}

/** Everyone, as the picker lists them: rated by rating, then the still-analyzing, then the absent by reason. */
export function fieldOf(view: CohortView, d: CohortDimension): { rated: FieldRow[]; pending: CohortMember[]; absent: AbsentGroup[] } {
  const list = ratedOn(view, d);
  const rated = list.map((member): FieldRow => {
    const r = ratingOf(member, d);
    return { member, rank: list.findIndex((m) => ratingOf(m, d) === r) + 1, tied: list.filter((m) => ratingOf(m, d) === r).length > 1 };
  });
  return { rated, pending: pendingOn(view, d), absent: absentGroups(view, d) };
}

/** The j/k stop order: the field's own order, top to bottom. */
export function fieldOrder(field: ReturnType<typeof fieldOf>): string[] {
  return [...field.rated.map((r) => r.member.memberId), ...field.pending.map((m) => m.memberId), ...field.absent.flatMap((g) => g.members.map((m) => m.memberId))];
}
