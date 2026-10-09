// The Score anatomy structure's pure half (spark analyze-v2-cohort round 2, layer `anatomy`):
// how a formula-made rating is DRAWN as the thing it was built from — a base, the parts that
// earned, the parts that lost — on one shared 0-100 scale; which reason stands behind each part
// (so a part can show its evidence); and where the points between two candidates come from.
// CLIENT-SAFE and pure; every rule here is pinned by anatomyModel.test.ts.
import { isTextPhrase } from "../../cohortTypes.ts";
import type { CohortDimension, CohortMember, CohortView, Phrase, Reason, ReasonTone, ScoreAnatomy } from "../../cohortTypes.ts";
import { byNeutral, ratedOn } from "../../dimensions/dimensionModel.ts";

/** A segment narrower than this share of the scale carries no in-bar label (its tip still does). */
export const LABEL_MIN_PCT = 14;
/** How many gap rows the focus sheet names before it sums the rest. */
export const GAP_ROWS = 4;

export type SegKind = "base" | "earn" | "half" | "lose";

export interface Seg {
  kind: SegKind;
  /** Drawn span on the 0-100 scale, clamped to it. */
  from: number;
  to: number;
  /** Signed points (the base's own value for `base`). */
  points: number;
  /** The anatomy part's phrase; null for the base. */
  phrase: Phrase | null;
  /** Index in anatomy.parts, or -1 for the base. */
  part: number;
  /** Wide enough for an in-bar label. */
  label: boolean;
}

export interface Geometry {
  segs: Seg[];
  /** Parts that earned nothing and are cons (a missing skill): named in the unearned track. */
  zeroCons: Phrase[];
  /** Where pros stop climbing (base + every positive part), unclamped. */
  peak: number;
  raw: number;
  rating: number;
  /** raw left the scale and the rating is the clamp of it. */
  clamped: boolean;
  /** base + sum(parts) === raw: the contract's exactness, checked rather than trusted. */
  sums: boolean;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));
const sum = (ns: readonly number[]): number => ns.reduce((a, b) => a + b, 0);

/**
 * The anatomy as drawn: the base from 0, then every earning part stacked upward from it (a
 * claimed-not-shown part, tone `note`, is half credit), then every losing part stacked back DOWN
 * from the peak, so the solid run ends at the rating and the hatched run between rating and peak
 * is what was lost. Zero-point parts have no width; the cons among them are kept to be named.
 */
export function anatomyGeometry(an: ScoreAnatomy, labelMin = LABEL_MIN_PCT): Geometry {
  const segs: Seg[] = [];
  const push = (s: Omit<Seg, "label" | "from" | "to"> & { a: number; b: number }) => {
    const from = clamp(Math.min(s.a, s.b));
    const to = clamp(Math.max(s.a, s.b));
    if (to - from <= 0) return;
    segs.push({ kind: s.kind, points: s.points, phrase: s.phrase, part: s.part, from, to, label: to - from >= labelMin });
  };
  if (an.base > 0) push({ kind: "base", points: an.base, phrase: null, part: -1, a: 0, b: an.base });
  let at = an.base;
  an.parts.forEach((p, i) => {
    if (p.points <= 0) return;
    push({ kind: p.tone === "note" ? "half" : "earn", points: p.points, phrase: p.phrase, part: i, a: at, b: at + p.points });
    at += p.points;
  });
  const peak = at;
  an.parts.forEach((p, i) => {
    if (p.points >= 0) return;
    push({ kind: "lose", points: p.points, phrase: p.phrase, part: i, a: at, b: at + p.points });
    at += p.points;
  });
  const zeroCons = an.parts.filter((p) => p.points === 0 && p.tone === "con").map((p) => p.phrase);
  return { segs, zeroCons, peak, raw: an.raw, rating: an.rating, clamped: an.raw !== an.rating, sums: an.base + sum(an.parts.map((p) => p.points)) === an.raw };
}

/** A phrase's identity for equality: the key and its params, or the verbatim text. */
export function phraseKey(p: Phrase): string {
  if (isTextPhrase(p)) return `t:${p.text}`;
  const params = p.params ? Object.keys(p.params).sort().map((k) => `${k}=${String(p.params![k])}`).join("&") : "";
  return `k:${p.key}?${params}`;
}

/**
 * What a part is ABOUT, so two candidates' parts line up: a skill by its name (matched, claimed
 * and missing Kafka are one row), analysis prose by its text, anything else by its key.
 */
export function partIdentity(p: Phrase): string {
  if (isTextPhrase(p)) return `t:${p.text.trim().toLowerCase()}`;
  const skill = p.params?.skill;
  if (skill !== undefined) return `s:${String(skill).trim().toLowerCase()}`;
  return `k:${p.key}`;
}

/** A part's in-bar word: the skill's own name where there is one, else the whole phrase. */
export const terseParam = (p: Phrase): string | null => (isTextPhrase(p) ? null : p.params?.skill !== undefined ? String(p.params.skill) : null);

export interface PartRow {
  phrase: Phrase;
  points: number;
  tone: ReasonTone;
  /** The reason standing behind this part (its evidence, its own wording), when one does. */
  reason: Reason | null;
  /** What the part falls short of full by, from a con reason worded like the part (e.g. "Experience 16/25": 9 short). */
  short: number | null;
}

export interface Attached {
  rows: PartRow[];
  /** Reasons no part stands for (a clean-trust pro, a probe note), by tone, in their order. */
  pros: Reason[];
  cons: Reason[];
  notes: Reason[];
}

/**
 * Pair every anatomy part with the reason behind it: one worded exactly like the part first,
 * else the first unpaired reason of the part's sign carrying the same points (experience words
 * its pro "6 years of experience" but its part "Experience 16/25"). A con worded like an
 * earning (or zero) part is its shortfall, not a second reason. Reasons left over are listed.
 */
export function attachReasons(an: ScoreAnatomy | undefined, why: { pros: Reason[]; cons: Reason[]; notes: Reason[] }): Attached {
  const all = [...why.pros, ...why.cons, ...why.notes];
  const used = new Set<Reason>();
  const rows: PartRow[] = (an?.parts ?? []).map((p) => {
    const key = phraseKey(p.phrase);
    const twins = all.filter((r) => !used.has(r) && phraseKey(r.phrase) === key);
    // A con worded like an earning or zero part carries what the part fell short of full by.
    const shortfall = p.points >= 0 ? twins.find((r) => r.tone === "con" && (r.points ?? 0) < 0) : undefined;
    let reason = twins.find((r) => r !== shortfall && (r.tone === p.tone || (p.points > 0 && r.tone !== "con"))) ?? null;
    if (!reason && p.points === 0 && shortfall) reason = shortfall;
    const short = shortfall ? -(shortfall.points as number) : null;
    if (shortfall) used.add(shortfall);
    if (!reason && p.points !== 0) {
      const tone: ReasonTone = p.points > 0 ? "pro" : "con";
      reason = all.find((r) => !used.has(r) && r.tone === tone && r.points === p.points) ?? null;
    }
    if (reason) used.add(reason);
    return { phrase: p.phrase, points: p.points, tone: p.tone, reason, short };
  });
  const left = (list: Reason[]) => list.filter((r) => !used.has(r));
  return { rows, pros: left(why.pros), cons: left(why.cons), notes: left(why.notes) };
}

export interface GapRow {
  id: string;
  phrase: Phrase;
  focus: number | null;
  other: number | null;
  /** focus minus other, in rating points. */
  delta: number;
}

export interface Gap {
  rows: GapRow[];
  /** focus.raw - other.raw: the rows' deltas sum to it exactly. */
  rawGap: number;
  ratingGap: number;
}

/**
 * Where the points between two candidates come from: their parts lined up by what they are about
 * (partIdentity), each row's delta = this candidate's points minus the other's (a part one side
 * lacks counts 0). Same base, so the deltas sum exactly to the raw gap. Biggest first; equal
 * rows drop out.
 */
export function gapBetween(focus: ScoreAnatomy, other: ScoreAnatomy): Gap {
  const rows = new Map<string, GapRow>();
  const add = (side: "focus" | "other", parts: ScoreAnatomy["parts"]) => {
    for (const p of parts) {
      const id = partIdentity(p.phrase);
      const row = rows.get(id) ?? { id, phrase: p.phrase, focus: null, other: null, delta: 0 };
      row[side] = (row[side] ?? 0) + p.points;
      if (side === "focus") row.phrase = p.phrase;
      rows.set(id, row);
    }
  };
  add("other", other.parts);
  add("focus", focus.parts);
  const baseDelta = focus.base - other.base;
  const list = [...rows.values()].map((r) => ({ ...r, delta: (r.focus ?? 0) - (r.other ?? 0) })).filter((r) => r.delta !== 0);
  list.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.id.localeCompare(b.id));
  if (baseDelta !== 0) list.unshift({ id: "base", phrase: { key: "base" }, focus: focus.base, other: other.base, delta: baseDelta });
  return { rows: list, rawGap: focus.raw - other.raw, ratingGap: focus.rating - other.rating };
}

/**
 * The field's order. Every floor but salary: by this rating, best first (an ORDER; the claim
 * strip says whether it is a lead). Salary is never ranked: by the asked figure, low to high,
 * like the claim strip says ("ordered by figure").
 */
export function fieldOrder(view: CohortView, d: CohortDimension): CohortMember[] {
  if (d !== "salary") return ratedOn(view, d);
  const mid = (m: CohortMember) => m.detail.salary?.midpoint ?? Number.POSITIVE_INFINITY;
  return view.members.filter((m) => m.cells.salary.rating != null).sort((a, b) => mid(a) - mid(b) || byNeutral(a, b));
}

export type Rival = { member: CohortMember; role: "leader" | "first" | "next" } | null;

/**
 * Whom the focused candidate is measured against. Salary and a floor below COHORT_MIN rated:
 * nobody (no comparative claim). The first in order otherwise, called the LEADER only when the
 * claim names them; the focused first is measured against the next.
 */
export function rivalOf(view: CohortView, d: CohortDimension, focusId: string | null): Rival {
  const claim = view.claims.byDimension[d];
  if (d === "salary" || claim.separation === "belowFloor" || !focusId) return null;
  const order = ratedOn(view, d);
  if (order.length < 2 || !order.some((m) => m.memberId === focusId)) return null;
  if (order[0].memberId === focusId) return { member: order[1], role: "next" };
  return { member: order[0], role: claim.separation === "clears" && claim.leader === order[0].memberId ? "leader" : "first" };
}

/** A signed point count as it reads: +17, −15 (a true minus), 0. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

/** Where each part's step starts on the drawn climb (earning parts accumulate; a zero part sits where it would have begun), clamped. */
export function partStarts(an: ScoreAnatomy): number[] {
  let at = an.base;
  return an.parts.map((p) => {
    const here = clamp(at);
    if (p.points > 0) at += p.points;
    return here;
  });
}

/**
 * What a model-judged row (fit) shows beside its plain bar: the model's first stated con and its
 * first note (the alignment read, which often decides fit), else its first pro. Never more than two.
 */
export function besideReasons(why: { pros: Reason[]; cons: Reason[]; notes: Reason[] }): Reason[] {
  const picked = [why.cons[0], why.notes[0]].filter((r): r is Reason => r !== undefined);
  return picked.length ? picked : why.pros.slice(0, 1);
}
