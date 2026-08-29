// E5 (Erika gap) — pure funnel-economics rules for source attribution. Kept
// DB-free so the median math and the pause heuristic are unit-tested in
// isolation (source-analytics.test.ts); db.ts feeds them the windowed rows.

// Campaign and variant names are recruiter-entered free text (source_campaign /
// source_variant, captured at intake), so a PRINTABLE delimiter inside one of them
// forges another pair's key: campaign "spring|A" × variant "v1" and campaign
// "spring" × variant "A|v1" both joined to `job|spring|A|v1`, merging two distinct
// creatives into one row. That moves groupTotal, and therefore the fair-share floor
// below and which variants get flagged for pausing. NUL-joined instead, the same
// reason and the same joiner analytics-cache.ts uses for its memo keys: the field
// values are NUL-free, so the concatenation cannot be forged.
const SEP = "\u0000";

/** The creative group a variant competes in: one (job × campaign) — the variants
 *  bidding for the same audience. */
export function variantGroupKey(jobId: string | null, campaign: string | null): string {
  return `${jobId ?? ""}${SEP}${campaign ?? ""}`;
}

/** One creative: (job × campaign × variant). Exported so the DB layer's row
 *  aggregation and the group key below can never key differently — the same
 *  single-sourcing MOMENTUM_EVENT_KINDS does for its SQL IN-list. */
export function variantRowKey(jobId: string | null, campaign: string | null, variant: string): string {
  return `${variantGroupKey(jobId, campaign)}${SEP}${variant}`;
}

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
//     leads landed, ≥ observeHours since the group's FIRST lead, AND ≥ observeHours
//     since THIS VARIANT's first lead (younger data flags nothing — early noise
//     isn't a verdict);
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

/** The lead share a recruiter reads ("holds {sharePct}% of {groupTotal} leads").
 *  Whole percent, EXCEPT that a variant which DID land leads is never reported as a
 *  flat 0: one lead in 201 is 0.5%, and `Math.round` printed that as "holds 0% of 201
 *  leads" — a false statement about a real number, and a sort key that collapsed every
 *  sub-1% variant into one tie so "worst performers first" ordered them arbitrarily. */
function sharePct(share: number): number {
  const whole = Math.round(share * 100);
  return whole > 0 ? whole : Math.round(share * 10_000) / 100;
}

export function variantPauseRecommendations(
  rows: readonly VariantStat[],
  nowMs: number
): VariantRecommendation[] {
  const groups = new Map<string, VariantStat[]>();
  for (const row of rows) {
    const key = variantGroupKey(row.jobId, row.campaign);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const observeMs = VARIANT_RULE.observeHours * 3_600_000;
  const observedFor = (v: VariantStat): number => {
    const first = v.firstLeadAt ? Date.parse(v.firstLeadAt) : NaN;
    return Number.isFinite(first) ? nowMs - first : NaN;
  };

  const recommendations: VariantRecommendation[] = [];
  for (const group of groups.values()) {
    if (group.length < VARIANT_RULE.minVariants) continue;
    const groupTotal = group.reduce((sum, v) => sum + v.total, 0);
    if (groupTotal < VARIANT_RULE.minGroupLeads) continue;
    // Group clock = the group's earliest lead: how long the COMPARISON has been
    // running. A group with no parseable first-lead timestamp is unobservable —
    // flag nothing.
    const groupAges = group.map(observedFor).filter((ms) => Number.isFinite(ms));
    if (groupAges.length === 0) continue;
    if (Math.max(...groupAges) < observeMs) continue;

    const flagBelow = (1 / group.length) * VARIANT_RULE.fairShareFactor;
    for (const v of group) {
      // …and each variant is judged on ITS OWN clock (VariantStat.firstLeadAt is
      // documented as exactly that). On the group clock alone, a creative added to a
      // long-running group was flagged the moment it appeared: 60/40/1 leads with the
      // third variant two hours old flagged that variant at a 1% share, under copy
      // that promises "after 72 hours of data". Early noise isn't a verdict — for the
      // group OR for the variant inside it.
      const age = observedFor(v);
      if (!Number.isFinite(age) || age < observeMs) continue;
      const share = v.total / groupTotal;
      if (share < flagBelow) {
        recommendations.push({
          jobTitle: v.jobTitle,
          campaign: v.campaign,
          variant: v.variant,
          leadSharePct: sharePct(share),
          groupTotal,
        });
      }
    }
  }
  // Worst performers first — the order a recruiter acts in.
  return recommendations.sort((a, b) => a.leadSharePct - b.leadSharePct);
}
