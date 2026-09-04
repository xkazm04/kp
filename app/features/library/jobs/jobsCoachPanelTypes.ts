// Wire types for JobsCoachPanel.tsx — extracted verbatim so the panel file
// stays under the 200-line split threshold.

export type Gate = { kind: "language" | "education"; value: string; eligibleDelta: number };
export type MustHave = { skill: string; missingAmongEligible: number; qualifiedDelta: number };
export type Salary = {
  family: string;
  seniority: string;
  jobBand: [number, number] | null;
  marketBand: [number, number] | null;
  // null = verdict honestly silenced (job band and benchmark band are in
  // different currencies; the pipeline does no FX — winnability.py mirror).
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
  // bug-ui-scan-2026-07-09 (pipeline-clis-script-bridges #4): candidates the CLI
  // couldn't score (a malformed/partially-extracted profile). Surfaced so the
  // recruiter sees the counts were computed over a reduced denominator.
  skipped?: { id: string; label: string; reason: string }[];
  // The shared candidate pool hit its caps, so every count above was computed over
  // a reduced denominator. Echoed by the route exactly as the candidates ranking
  // echoes it, so both surfaces admit the same cap in the same words.
  poolTruncated?: boolean;
};
