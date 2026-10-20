/**
 * The Spine - one grammar for any ordered, typed, timestamped process.
 *
 * An adapter turns raw records into `SpineInstance`s; everything here is derived from them and
 * nothing is declared: the standard path is the most-travelled chain of steps, braided only
 * where the data genuinely forks; every instance is aligned against it; each station then
 * knows how many instances reached it, skipped it, stumbled at it and left the path there.
 *
 * Ported from the process-strategic contest winner (The Spine); the same module drives the
 * Personas Curator Process page, so the two products read processes through one grammar.
 * Pure, no React.
 */

export interface SpineStep {
  /** Step kind in the adapter's vocabulary (already phased when the adapter phases). */
  k: string;
  /** Seconds on the process clock (calendar or active time; the adapter decides). */
  t: number;
  /** Tool/event errors inside this step. */
  err: number;
  /** True when this step is friction by itself (an interrupt, a hold). */
  friction: boolean;
}

export interface SpineInstance {
  id: string;
  group: string;
  outcome: string;
  steps: SpineStep[];
}

export interface Station {
  index: number;
  /** One key, or several when the data braids here (e.g. `verify / ship`). */
  keys: string[];
  reached: number;
  skipped: number;
  /** Instances with friction (errors, interrupts, holds) attributed to this station. */
  friction: number;
  /** Instances whose failed outcome is filed here: they ended at this station, or completed the path and still failed. */
  exits: number;
  exitBy: Record<string, number>;
  /** Median and p75 wait before this station, on the adapter's clock. */
  medWait: number;
  p75Wait: number;
  /** Instance ids behind `friction` and `exits`, for the descent. */
  failureIds: string[];
}

export interface SpineModel {
  n: number;
  stations: Station[];
  onPath: number;
  walkedAll: number;
  outcomes: Record<string, number>;
  /** Station indexes with any failure, ordered by failed endings, then friction, then position. */
  worst: number[];
}

type Token = { tok: string; t: number };

/** First occurrence of each kind, in order - a session revisits phases; the path is about order. */
function tokenize(inst: SpineInstance): Token[] {
  const seen = new Set<string>();
  const out: Token[] = [];
  for (const st of inst.steps) {
    if (seen.has(st.k)) continue;
    seen.add(st.k);
    out.push({ tok: st.k, t: st.t });
  }
  return out;
}

const END = '∅';

/** The most-travelled chain; a position braids when an alternative is >= 40% of the leader and continues on. */
export function derivePath(tokens: Token[][]): string[][] {
  const path: string[][] = [];
  let cursor = tokens.map((toks) => ({ toks, p: -1 }));
  const n = tokens.length;
  for (let guard = 0; cursor.length && guard < 40; guard++) {
    const count = new Map<string, number>();
    const rest = new Map<string, number>();
    for (const c of cursor) {
      const nx = c.toks[c.p + 1];
      const key = nx ? nx.tok : END;
      count.set(key, (count.get(key) ?? 0) + 1);
      rest.set(key, (rest.get(key) ?? 0) + (c.toks.length - c.p - 2));
    }
    const ranked = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
    const lead = ranked[0] === END ? ranked[1] : ranked[0];
    if (!lead || count.get(lead)! < Math.max(3, n * 0.06)) break;
    if (ranked[0] === END && count.get(lead)! < 0.5 * count.get(END)!) break;
    const pos = [lead];
    const leadRest = rest.get(lead)! / count.get(lead)!;
    for (const t of ranked.slice(0, 4)) {
      if (t === END || t === lead) continue;
      const c = count.get(t)!;
      if (c >= 0.4 * count.get(lead)! && rest.get(t)! / c >= 0.5 * leadRest && path.every((p) => !p.includes(t))) pos.push(t);
    }
    path.push(pos);
    cursor = cursor
      .filter((c) => { const nx = c.toks[c.p + 1]; return nx && pos.includes(nx.tok); })
      .map((c) => ({ toks: c.toks, p: c.p + 1 }));
  }
  return path;
}

interface Alignment { reach: number; matched: (Token | null)[]; waits: number[]; skipped: number[]; detoured: boolean; frictionAt: number[] }

function align(inst: SpineInstance, toks: Token[], path: string[][]): Alignment {
  const where = new Map<string, number>();
  path.forEach((pos, q) => pos.forEach((t) => where.set(t, q)));
  const matched: (Token | null)[] = path.map(() => null);
  const waits: number[] = [];
  let p = 0, lastT = 0, detoured = false;
  for (const tk of toks) {
    const q = where.get(tk.tok);
    if (q != null && q >= p) { matched[q] = tk; waits[q] = tk.t - lastT; lastT = tk.t; p = q + 1; }
    else if (q == null) detoured = true;
  }
  const skipped: number[] = [];
  for (let s = 0; s < p; s++) if (!matched[s]) skipped.push(s);
  // Friction belongs to the step it happened in: an error while verifying is a verify failure,
  // even when the session had already shipped once. Only a step whose kind is not on the path
  // falls back to the last station reached before it.
  const frictionAt: number[] = [];
  for (const st of inst.steps) {
    if (!st.friction && st.err <= 0) continue;
    let at = where.get(st.k);
    if (at == null) {
      at = 0;
      matched.forEach((m, q) => { if (m && m.t <= st.t) at = q; });
    }
    if (!frictionAt.includes(at)) frictionAt.push(at);
  }
  return { reach: p, matched, waits, skipped, detoured, frictionAt };
}

function quantile(values: number[], q: number): number {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const i = (a.length - 1) * q;
  const lo = a[Math.floor(i)] ?? NaN;
  const hi = a[Math.ceil(i)] ?? lo;
  return lo + (hi - lo) * (i - Math.floor(i));
}

/** A station while it is being counted: the public figures plus what they are computed from. */
type Acc = { s: Station; waits: number[]; failed: Set<string> };

/**
 * Build the spine for a cohort. `isFailure` says which outcomes are failures - an outcome that is
 * neither good nor a failure (a read-only session that ended clean) is not counted against a
 * station. `pathFrom` lets a
 * filtered view (one group) be measured against the whole cohort's path so stations stay comparable.
 */
export function buildSpine(list: SpineInstance[], isFailure: (outcome: string) => boolean, pathFrom?: SpineInstance[]): SpineModel {
  const path = derivePath((pathFrom ?? list).map(tokenize));
  const acc: Acc[] = path.map((keys, index) => ({
    s: { index, keys, reached: 0, skipped: 0, friction: 0, exits: 0, exitBy: {}, medWait: NaN, p75Wait: NaN, failureIds: [] },
    waits: [],
    failed: new Set<string>(),
  }));
  const outcomes: Record<string, number> = {};
  let onPath = 0, walkedAll = 0;
  for (const inst of list) {
    const a = align(inst, tokenize(inst), path);
    outcomes[inst.outcome] = (outcomes[inst.outcome] ?? 0) + 1;
    acc.forEach((st, q) => {
      if (q >= a.reach) return;
      st.s.reached++;
      const here = a.matched[q];
      const wait = a.waits[q];
      if (!here) st.s.skipped++;
      else if (q > 0 && a.matched[q - 1] && wait != null) st.waits.push(wait);
    });
    for (const q of a.frictionAt) {
      const st = acc[q];
      if (st) { st.s.friction++; st.failed.add(inst.id); }
    }
    const ended = a.reach < path.length;
    if (!a.skipped.length && !a.detoured) onPath++;
    if (!ended && !a.skipped.length) walkedAll++;
    const exitAt = acc[Math.max(0, (ended ? a.reach : path.length) - 1)];
    if (isFailure(inst.outcome) && exitAt) {
      exitAt.s.exits++;
      exitAt.s.exitBy[inst.outcome] = (exitAt.s.exitBy[inst.outcome] ?? 0) + 1;
      exitAt.failed.add(inst.id);
    }
  }
  const stations = acc.map(({ s, waits, failed }) => ({
    ...s,
    medWait: quantile(waits, 0.5),
    p75Wait: quantile(waits, 0.75),
    failureIds: [...failed],
  }));
  const worst = stations
    .map((s) => ({ q: s.index, e: s.exits, f: s.friction }))
    .filter((x) => x.e + x.f > 0)
    .sort((a, b) => b.e - a.e || b.f - a.f || a.q - b.q)
    .map((x) => x.q);
  return { n: list.length, stations, onPath, walkedAll, outcomes, worst };
}
