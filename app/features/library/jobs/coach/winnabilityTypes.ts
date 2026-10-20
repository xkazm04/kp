// The winnability wire shape — the payload GET /api/jobs/[id]/winnability answers
// with (was jobsCoachPanelTypes.ts). Split out of rolePatterns.ts so that file stays
// under the 200-line split threshold; rolePatterns re-exports it, so the variants and
// the hook still import ONE module.

export type Gate = { kind: "language" | "education"; value: string; eligibleDelta: number };
// Present only when the gates jointly exclude people no single gate accounts for (the
// same candidates fail two): eligibleDelta is what removing ALL the listed gates
// restores, soleBlockerSum what the per-gate deltas add up to. Names no single culprit.
export type JointLoosen = { eligibleDelta: number; soleBlockerSum: number; gates: { kind: "language" | "education"; value: string }[] };
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
  // The ad's own inputs the verdict was silenced for ("salary_band" = it stated no pay,
  // "seniority" = the market band is for a level it never claimed). Empty/absent = none.
  assumedInputs?: ("salary_band" | "seniority")[];
};
export type Winnability = {
  poolSize: number;
  eligible?: number;
  qualified?: number;
  fitThreshold?: number;
  looseGates?: Gate[];
  jointLoosen?: JointLoosen;
  looseMustHaves?: MustHave[];
  // Present only when NO single demotion moves anyone: the pairs of must-haves that do
  // (best first). "The pool is not close" is only the verdict when this is absent.
  jointDemote?: { skills: [string, string]; qualifiedDelta: number }[];
  salary?: Salary;
  /** Candidates the CLI couldn't score, so every count is over a reduced denominator. */
  skipped?: { id: string; label: string; reason: string }[];
  /** The shared candidate pool hit its caps — the same admission the ranking makes. */
  poolTruncated?: boolean;
};

