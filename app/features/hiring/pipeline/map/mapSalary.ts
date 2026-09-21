// A per-candidate salary expectation for the overlay's salary branches.
//
// THE REAL SOURCE IS NOT ON THE WIRE YET. A candidate's expectation lives in
// their saved CV analysis (`analyses.payload.salary` — minimum/maximum/midpoint/
// currency, read by `salaryExpectationFrom` in app/_lib/group-eval-run.ts); the
// ranking route the overlay already fetches (GET /api/jobs/[id]/candidates) only
// carries the ROLE's band (`result.salaryBand`). Threading the expectation onto
// that route is the next step (pipeline README, Known gaps). Until then this
// module returns a deterministic STAND-IN spread inside the role's band
// (±25% around it, hashed from the candidate id), so the axis can be judged with
// a realistic shape. Every consumer must label it as an estimate.
//
// Amounts are bare numbers in the ORGANIZATION's currency (org-settings.ts): the
// role band is stored without a unit, so the unit is whatever the org declared.

import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { MatchResultView } from "@/app/features/shared/matchTypes";

export type SalaryPoint = {
  /** Monthly midpoint the candidate expects (stand-in, see header). */
  midpoint: number;
  /** The role's own band, when the ranking carried one. */
  roleBand: [number, number] | null;
  /** Where the expectation sits against the band: below / inside / above. */
  fit: "below" | "inside" | "above" | "unknown";
  /** True for every value this module invented (currently: all of them). */
  estimated: boolean;
};

/** The stand-in's span when the ranking carried no band at all. */
const FALLBACK_BAND: [number, number] = [40000, 80000];

// FNV-1a with a final avalanche. A plain polynomial hash put the seed corpus's
// sequential ids ("cand-021", "cand-022", …) one apart, so `% 10007` landed them
// all on the same salary and the whole cell collapsed into one branch.
const hash = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** The role band from any candidate's match row (they all carry the same one). */
export function roleBandOf(matchByCandidate: ReadonlyMap<string, MatchResultView>): [number, number] | null {
  for (const m of matchByCandidate.values()) {
    const b = (m as { salaryBand?: number[] }).salaryBand;
    if (b && b.length >= 2 && b[0] > 0 && b[1] >= b[0]) return [b[0], b[1]];
  }
  return null;
}

export function salaryPointOf(e: Pick<Entry, "id" | "candidateId">, roleBand: [number, number] | null): SalaryPoint {
  const [lo, hi] = roleBand ?? FALLBACK_BAND;
  const span = hi - lo;
  // Uniform in [lo − 25% span, hi + 25% span], rounded to a step that suits the
  // magnitude (500 on a 60k band, 50 on a 4k one).
  const u = (hash(e.candidateId ?? e.id) % 10007) / 10007;
  const raw = lo - span * 0.25 + u * span * 1.5;
  const unit = hi >= 20000 ? 500 : 50;
  const midpoint = Math.round(raw / unit) * unit;
  const fit = !roleBand ? "unknown" : midpoint < lo ? "below" : midpoint > hi ? "above" : "inside";
  return { midpoint, roleBand, fit, estimated: true };
}

const thousands = (n: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n / 1000);

/** "52k" / "4,5k" — thousands, at most one decimal, grouped in the reader's locale.
 *  Unit-less: pair it with `withCurrency` (org-settings.ts) at the render site. */
export function kAmount(n: number, locale: string): string {
  return `${thousands(n, locale)}k`;
}

/** "45–50k" — a bucket's range on one "k" scale. */
export function kRange(lo: number, hi: number, locale: string): string {
  return `${thousands(lo, locale)}–${thousands(hi, locale)}k`;
}
