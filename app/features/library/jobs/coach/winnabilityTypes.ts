// The winnability wire shape — the payload GET /api/jobs/[id]/winnability answers
// with (was jobsCoachPanelTypes.ts). Split out of rolePatterns.ts so that file stays
// under the 200-line split threshold; rolePatterns re-exports it, so the variants and
// the hook still import ONE module.

export type Gate = { kind: "language" | "education"; value: string; eligibleDelta: number };
export type MustHave = { skill: string; missingAmongEligible: number; qualifiedDelta: number };
export type Salary = {
  family: string;
  seniority: string;
  jobBand: [number, number] | null;
  marketBand: [number, number] | null;
  // null = verdict honestly silenced (job band and benchmark band are in different
  // currencies; the pipeline does no FX — winnability.py mirror).
  belowMarket: boolean | null;
  currencyComparable?: boolean;
  topVsMarketFloorPct?: number;
};
export type Winnability = {
  poolSize: number;
  eligible?: number;
  qualified?: number;
  fitThreshold?: number;
  looseGates?: Gate[];
  looseMustHaves?: MustHave[];
  salary?: Salary;
  /** Candidates the CLI couldn't score, so every count is over a reduced denominator. */
  skipped?: { id: string; label: string; reason: string }[];
  /** The shared candidate pool hit its caps — the same admission the ranking makes. */
  poolTruncated?: boolean;
};

