// E5 (Erika gap) — pure funnel-economics rules for source attribution. Kept
// DB-free so the median math and the pause heuristic are unit-tested in
// isolation (source-analytics.test.ts); db.ts feeds them the windowed rows.

export type VariantStat = {
  jobId: string | null;
  jobTitle: string | null;
  campaign: string | null;
  variant: string;
  total: number;
  reachedInterview: number;
  hired: number;
  /** ISO timestamp of the variant's earliest lead (its observation clock). */
  firstLeadAt: string | null;
};

export type VariantRecommendation = {
  jobTitle: string | null;
  campaign: string | null;
  variant: string;
  /** This variant's share of its group's leads, rounded percent. */
  leadSharePct: number;
  groupTotal: number;
};

// The sourcing playbook's iteration rule ("run 6–12 variants, pause bottom
// performers within 72 hours"), translated to the signal we actually hold —
// lead counts per variant, not ad-platform CTR/spend:
//   - a creative group = one (job × campaign): the variants competing for the
//     same audience;
//   - judge only after MIN observation: ≥ minVariants competing, ≥ minGroupLeads
//     leads landed, and ≥ observeHours since the group's FIRST lead (younger
//     data flags nothing — early noise isn't a verdict);
//   - flag a variant whose lead share is under fairShareFactor × its fair split
//     (with 4 variants, fair = 25%, flagged under 12.5%).
// A RECOMMENDATION, never an actuator — the recruiter pauses the ad, not kp.
export const VARIANT_RULE = {
  minVariants: 2,
  minGroupLeads: 10,
  observeHours: 72,
  fairShareFactor: 0.5,
} as const;

/** Median of durations (ms) in hours, 0.1h precision. Negative/NaN durations
 *  (clock skew, malformed timestamps) are dropped, not clamped; null when
 *  nothing valid remains. */
export function medianHours(durationsMs: readonly number[]): number | null {
  const valid = durationsMs.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  const ms = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export function variantPauseRecommendations(
  rows: readonly VariantStat[],
  nowMs: number
): VariantRecommendation[] {
  const groups = new Map<string, VariantStat[]>();
  for (const row of rows) {
    const key = `${row.jobId ?? ""}|${row.campaign ?? ""}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const recommendations: VariantRecommendation[] = [];
  for (const group of groups.values()) {
    if (group.length < VARIANT_RULE.minVariants) continue;
    const groupTotal = group.reduce((sum, v) => sum + v.total, 0);
    if (groupTotal < VARIANT_RULE.minGroupLeads) continue;
    // Observation clock = the group's earliest lead. A group with no parseable
    // first-lead timestamp is unobservable — flag nothing.
    const firstLeadTimes = group
      .map((v) => (v.firstLeadAt ? Date.parse(v.firstLeadAt) : NaN))
      .filter((ms) => Number.isFinite(ms));
    if (firstLeadTimes.length === 0) continue;
    if (nowMs - Math.min(...firstLeadTimes) < VARIANT_RULE.observeHours * 3_600_000) continue;

    const flagBelow = (1 / group.length) * VARIANT_RULE.fairShareFactor;
    for (const v of group) {
      const share = v.total / groupTotal;
      if (share < flagBelow) {
        recommendations.push({
          jobTitle: v.jobTitle,
          campaign: v.campaign,
          variant: v.variant,
          leadSharePct: Math.round(share * 100),
          groupTotal,
        });
      }
    }
  }
  // Worst performers first — the order a recruiter acts in.
  return recommendations.sort((a, b) => a.leadSharePct - b.leadSharePct);
}
