// Cohort probe-miss aggregation for the Dev Case studio (idea-fec3e23a). Each
// submission's evaluation already records, per covert probe, whether the
// candidate detected it and handled it well (ToolingSignal.probeOutcomes). Rolling
// those up across a case's whole cohort reveals which probes everyone collectively
// misses — a probe the entire field walks past is usually a MISCALIBRATED case
// (the seam is too hidden or ambiguous), not five weak candidates in a row.
//
// Pure + import-free (minimal structural input types, no @/ imports) so it's
// unit-testable under bare node --test and the studio can aggregate the
// submissions it already holds with no extra fetch.

type ProbeLike = { id?: string; kind?: string; where?: string; reveals?: string };
type OutcomeLike = { probeId?: string; detected?: boolean; handledWell?: boolean };
type SubmissionLike = { evaluation?: { tooling?: { probeOutcomes?: OutcomeLike[] } | null } | null };

export type ProbeHeatCell = {
  probeId: string;
  kind: string;
  where: string;
  reveals: string;
  // Submissions that carry an outcome for THIS probe (an unevaluated submission
  // contributes nothing — rates are over the evaluated subset, never the roster).
  evaluated: number;
  detected: number;
  handledWell: number;
  // not-detected / evaluated, and not-handled-well / evaluated. null when no
  // submission has been evaluated against this probe yet.
  missRate: number | null;
  weakRate: number | null;
};

export type CohortProbeHeatmap = {
  cells: ProbeHeatCell[];
  submissionCount: number; // total submissions passed in
  evaluatedCount: number; // submissions carrying any probe outcome
};

/** Roll a case's probes up across its submissions' probe outcomes. Probes keep
 *  their declared order (the case's coverProbes order) so the heatmap reads the
 *  same as the internal probe list above it. */
export function probeMissHeatmap(probes: ProbeLike[], submissions: SubmissionLike[]): CohortProbeHeatmap {
  // Index every submission's outcomes by probeId once.
  const outcomesByProbe = new Map<string, OutcomeLike[]>();
  let evaluatedCount = 0;
  for (const sub of submissions) {
    const outcomes = sub.evaluation?.tooling?.probeOutcomes ?? [];
    if (outcomes.length > 0) evaluatedCount += 1;
    for (const o of outcomes) {
      if (!o.probeId) continue;
      (outcomesByProbe.get(o.probeId) ?? outcomesByProbe.set(o.probeId, []).get(o.probeId)!).push(o);
    }
  }

  const cells: ProbeHeatCell[] = [];
  for (const probe of probes) {
    if (!probe.id) continue;
    const outcomes = outcomesByProbe.get(probe.id) ?? [];
    const evaluated = outcomes.length;
    const detected = outcomes.filter((o) => o.detected === true).length;
    const handledWell = outcomes.filter((o) => o.handledWell === true).length;
    cells.push({
      probeId: probe.id,
      kind: probe.kind ?? "probe",
      where: probe.where ?? "",
      reveals: probe.reveals ?? "",
      evaluated,
      detected,
      handledWell,
      missRate: evaluated > 0 ? (evaluated - detected) / evaluated : null,
      weakRate: evaluated > 0 ? (evaluated - handledWell) / evaluated : null,
    });
  }

  return { cells, submissionCount: submissions.length, evaluatedCount };
}
