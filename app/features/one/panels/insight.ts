// The `insight` look's numbers — PURE, from the data a panel already read (no new route,
// never a figure from the reply's words). docs/design/one-interface.md "Round 3 core".
//
// "Insight, not rows": the main column's card says what the SHAPE of the answer is (where
// the candidates stand, how the scores spread, who has waited longest, which role carries
// most) and offers at most ONE next act, while the side table carries every row. Nothing
// here repeats the table's count as a headline.
//
// The one suggested act only ever touches a candidate the card describes: a single-entry
// advance through the existing door (`POST /api/pipeline/[id]`), never a board-wide wave and
// never a reject.
import type { OneEntry } from "./pipelineRead";

/** A row at or above this score is worth suggesting for an advance. */
export const ADVANCE_LINE = 65;

/** Score bins for the spread strip: their edges sit on the command bar's usual lines (40, 65) and on the
 *  board's own tiers (50, 75 — format.ts SCORE_MID_MIN / SCORE_STRONG_MIN). */
export const SCORE_BINS = [
  { key: "lt40", lo: 0, hi: 40, tone: "weak" },
  { key: "40", lo: 40, hi: 50, tone: "weak" },
  { key: "50", lo: 50, hi: 65, tone: "mid" },
  { key: "65", lo: 65, hi: 75, tone: "mid" },
  { key: "75", lo: 75, hi: 101, tone: "strong" },
] as const;
export type ScoreBinKey = (typeof SCORE_BINS)[number]["key"];

export type StageCount = { stage: string; label: string; count: number };
export type Waiter = { id: string; label: string; stageLabel: string; days: number; stale: boolean };
export type RoleCount = { title: string; count: number };
export type EntrySuggestion = { entry: OneEntry; reason: "score" | "stalled" };

export type EntryInsight = {
  /** Count per stage, largest first; past `maxStages` the rest fold into one "other" part. */
  stages: StageCount[];
  other: number;
  /** Scored entries per SCORE_BINS bin (an unscored entry is counted apart, never as 0 %). */
  bins: Record<ScoreBinKey, number>;
  unscored: number;
  /** The entry that has stood longest on its stage (a known age only). */
  oldest: Waiter | null;
  /** The role with most entries — only when the rows span more than one role. */
  topRole: RoleCount | null;
};

export function entryInsight(rows: readonly OneEntry[], maxStages = 4): EntryInsight {
  const byStage = new Map<string, StageCount>();
  const bins = Object.fromEntries(SCORE_BINS.map((b) => [b.key, 0])) as Record<ScoreBinKey, number>;
  const byRole = new Map<string, number>();
  let unscored = 0;
  let oldest: Waiter | null = null;
  for (const e of rows) {
    const s = byStage.get(e.stage) ?? { stage: e.stage, label: e.stageLabel, count: 0 };
    s.count++;
    byStage.set(e.stage, s);
    if (e.score === null) unscored++;
    else {
      const bin = SCORE_BINS.find((b) => e.score! >= b.lo && e.score! < b.hi) ?? SCORE_BINS[SCORE_BINS.length - 1];
      bins[bin.key]++;
    }
    if (e.jobTitle) byRole.set(e.jobTitle, (byRole.get(e.jobTitle) ?? 0) + 1);
    if (e.ageDays !== null && (oldest === null || e.ageDays > oldest.days)) {
      oldest = { id: e.id, label: e.label, stageLabel: e.stageLabel, days: e.ageDays, stale: e.stale };
    }
  }
  const sorted = [...byStage.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const stages = sorted.length > maxStages ? sorted.slice(0, maxStages - 1) : sorted;
  const other = sorted.slice(stages.length).reduce((n, s) => n + s.count, 0);
  const roles = [...byRole.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topRole = roles.length > 1 ? { title: roles[0][0], count: roles[0][1] } : null;
  return { stages, other, bins, unscored, oldest, topRole };
}

/** The ONE next act the card may offer: a SINGLE-ENTRY advance on a candidate IN the rows
 *  the card describes (never a wave over the board, never a reject — an adverse act is the
 *  recruiter's own pick from the table):
 *    - the highest-scoring row at or above ADVANCE_LINE → advance them (reason: score);
 *    - else the longest waiter, when stalled → advance them (reason: stalled);
 *    - else nothing.
 *  The act carries the row's stage, so the door's compare-and-swap refuses a stale pick. */
export function suggestEntry(rows: readonly OneEntry[]): EntrySuggestion | null {
  let best: OneEntry | null = null;
  for (const e of rows) {
    if (e.score !== null && e.score >= ADVANCE_LINE && (best === null || e.score > (best.score ?? -1))) best = e;
  }
  if (best) return { entry: best, reason: "score" };
  let oldest: OneEntry | null = null;
  for (const e of rows) if (e.ageDays !== null && (oldest === null || e.ageDays > (oldest.ageDays ?? -1))) oldest = e;
  return oldest && oldest.stale ? { entry: oldest, reason: "stalled" } : null;
}

/** The suggestion as the `entryAdvance` act's params (consent/actParams.ts). */
export function entryParams(e: OneEntry): Record<string, string> {
  return { entryId: e.id, expectedStage: e.stage, label: e.label, ...(e.jobTitle ? { role: e.jobTitle } : {}) };
}

/* ── funnel ─────────────────────────────────────────────────────────────── */

export type FunnelStep = { stage: string; reached: number };
export type FunnelInsight = {
  /** The biggest stage-to-stage loss, as a share of the earlier stage. */
  drop: { from: string; to: string; lostPct: number } | null;
  /** Last stage reached ÷ first stage reached, as a whole percent. */
  overallPct: number | null;
};

export function funnelInsight(steps: readonly FunnelStep[]): FunnelInsight {
  let drop: FunnelInsight["drop"] = null;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    if (a.reached <= 0) continue;
    const lostPct = Math.round(((a.reached - b.reached) / a.reached) * 100);
    if (lostPct > 0 && (drop === null || lostPct > drop.lostPct)) drop = { from: a.stage, to: b.stage, lostPct };
  }
  const first = steps[0];
  const last = steps.at(-1);
  const overallPct = first && last && steps.length > 1 && first.reached > 0 ? Math.round((last.reached / first.reached) * 100) : null;
  return { drop, overallPct };
}

/* ── schedule ───────────────────────────────────────────────────────────── */

export const AHEAD_BUCKETS = ["today", "week", "month", "later"] as const;
export type AheadBucket = (typeof AHEAD_BUCKETS)[number];

const DAY = 86_400_000;

/** Interviews ahead by horizon: within 24 h, the rest of 7 days, of 30 days, later. */
export function aheadBuckets(slots: readonly string[], now: number): Record<AheadBucket, number> {
  const out: Record<AheadBucket, number> = { today: 0, week: 0, month: 0, later: 0 };
  for (const iso of slots) {
    const dt = Date.parse(iso) - now;
    if (!Number.isFinite(dt) || dt < 0) continue;
    out[dt < DAY ? "today" : dt < 7 * DAY ? "week" : dt < 30 * DAY ? "month" : "later"]++;
  }
  return out;
}

/* ── outbox / drafts / needs ────────────────────────────────────────────── */

/** How many of each value, largest first (ties keep first-seen order). */
export function tally<T extends string>(values: readonly T[]): { key: T; count: number }[] {
  const m = new Map<T, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

/** The biggest bucket by count — the first in the given (priority) order on a tie; none when all are 0. */
export function biggest<K extends string>(counts: Partial<Record<K, number>>, order: readonly K[]): { key: K; count: number } | null {
  let best: { key: K; count: number } | null = null;
  for (const k of order) {
    const n = counts[k];
    if (typeof n === "number" && n > 0 && (best === null || n > best.count)) best = { key: k, count: n };
  }
  return best;
}
