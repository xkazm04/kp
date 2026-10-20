// The eval panel's headline, as data (challenge-r05 devcase-core/B).
//
// The rubric weights shown beside every capability bar used to be decoration: the number above
// the bars was `transferScore` — on keyless installs an equal-weight mean, on the LLM path the
// model's own figure — so the bars and the headline told two stories. The evaluator now stamps
// `overallScore`, the rubric-weighted case score, and a `contribution` on every row, with the
// rows summing to it (registry: component-sum-is-authoritative). This module decides what the
// panel may claim from a bundle:
//
//   composite — the bundle carries a valid case score: it is the headline, each row shows its
//               contribution, an unscored dimension is marked missing (excluded, not a 50);
//   legacy    — a bundle persisted before the composite existed: no headline value and
//               `weightsApplied: false`, so an old run never displays weights as if applied.
//
// Transfer stays its own labelled figure on both — it is what the promote verdict reads, and on
// the LLM path it is an independent judgement, not a sum of these rows.
//
// Pure and import-free at runtime (type-only imports), so node:test loads it directly.
import type { CaseEval, DimensionScore, Transfer } from "./DevTypes";

export type HeadlineRow = {
  name: string;
  label: string;
  weight: number;
  score: number;
  description: string;
  /** Points of the case score this row supplies; null when not scored or on a legacy bundle. */
  contribution: number | null;
  /** Not scored: excluded from the case score (never imputed). */
  missing: boolean;
};

export type ScoreHeadline =
  | {
      kind: "composite";
      value: number;
      weightsApplied: true;
      rows: HeadlineRow[];
      transfer: number | null;
      missing: string[];
      scoredWeight: number;
      weightsNormalised: boolean;
      /** The stamped figure disagreed with its own rows by more than half a point, so the
       *  headline was pinned to the rows' sum (the parts are the evidence; the total is the claim). */
      recomputed: boolean;
    }
  | {
      kind: "legacy";
      value: null;
      weightsApplied: false;
      rows: HeadlineRow[];
      transfer: number | null;
      missing: string[];
      scoredWeight: null;
      weightsNormalised: false;
      recomputed: false;
    };

const isScore = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

export function headlineFor(evaluation: CaseEval | undefined, transfer: Transfer | undefined, breakdown?: DimensionScore[]): ScoreHeadline {
  const e = evaluation ?? {};
  const transferScore = isScore(transfer?.transferScore) ? transfer.transferScore : null;
  const source = e.dimensions && e.dimensions.length ? e.dimensions : (breakdown ?? []);
  const missingNames = new Set(Array.isArray(e.missingDimensions) ? e.missingDimensions : []);

  if (isScore(e.overallScore)) {
    const rows = source.map((d) => {
      const contribution = typeof d.contribution === "number" && Number.isFinite(d.contribution) ? d.contribution : null;
      return { ...d, contribution, missing: missingNames.has(d.name) || contribution === null };
    });
    // component-sum-is-authoritative: the rows are the record, so a headline that drifted from
    // them (a hand-edited or partially migrated bundle) is pinned to their sum, not trusted.
    const scored = rows.filter((r) => r.contribution !== null);
    const sum = scored.reduce((acc, r) => acc + (r.contribution ?? 0), 0);
    const recomputed = scored.length > 0 && Math.abs(sum - e.overallScore) > 0.5;
    return {
      kind: "composite",
      value: recomputed ? Math.round(sum) : e.overallScore,
      recomputed,
      weightsApplied: true,
      rows,
      transfer: transferScore,
      missing: rows.filter((r) => r.missing).map((r) => r.name),
      scoredWeight: typeof e.scoredWeight === "number" && Number.isFinite(e.scoredWeight) ? e.scoredWeight : 1,
      weightsNormalised: e.weightsNormalised === true,
    };
  }
  return {
    kind: "legacy",
    value: null,
    weightsApplied: false,
    rows: source.map((d) => ({ ...d, contribution: null, missing: false })),
    transfer: transferScore,
    missing: [],
    scoredWeight: null,
    weightsNormalised: false,
    recomputed: false,
  };
}

/** "+8.0" — one decimal, the contribution's own sign convention (contributions are never negative). */
export function formatContribution(points: number): string {
  return `+${points.toFixed(1)}`;
}
