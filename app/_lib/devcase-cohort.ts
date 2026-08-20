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
type OutcomeLike = { probeId?: string; detected?: boolean; handledWell?: boolean | null };
type SubmissionLike = {
  evaluation?: {
    tooling?: { probeOutcomes?: OutcomeLike[] } | null;
    // Provenance of each evaluation step (devcase_cli's envelope): "llm" | "observed"
    // | "deterministic". See DETERMINISTIC_TOOLING below.
    perStepSources?: Record<string, string> | null;
  } | null;
};

// The tooling step ran on the deterministic TEMPLATE — keyless, --no-llm, or an LLM
// call that raised and fell back (reflect.assess_tooling's `deterministic()`). That
// template stamps EVERY probe `detected: false, handledWell: false,
// note: "insufficient signal (deterministic)"`, so folding those rows into the cohort
// rates manufactures a 100 %-miss verdict on every probe from the absence of an API
// key — and lights the studio's "this case is miscalibrated" banner over it. kp
// degrading keyless is a product property, so this is the DEFAULT local state, not an
// edge case. Such a submission is treated as not assessed against the probes at all
// (out of both numerator and denominator), the same rule an ungraded handledWell gets.
// Bundles predating perStepSources carry no verdict either way and are kept.
const DETERMINISTIC_TOOLING = "deterministic";

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
  // Outcomes whose handling was actually GRADED (handledWell true|false). The
  // observed Live Work Surface path emits handledWell null BY DESIGN — it can see
  // that the candidate worked the probe's area but cannot grade the handling
  // (process_events.tooling_from_events) — and DevTypes' ProbeOutcome contract is
  // explicit that consumers must treat null as "unknown", not "failed".
  graded: number;
  // not-detected / evaluated, and not-handled-well / GRADED. missRate is null when
  // no submission has been evaluated against this probe yet; weakRate is null when
  // no submission's handling of it was graded.
  missRate: number | null;
  weakRate: number | null;
};

export type CohortProbeHeatmap = {
  cells: ProbeHeatCell[];
  submissionCount: number; // total submissions passed in
  // Submissions carrying a real probe assessment (deterministic-fallback tooling is
  // not one — see DETERMINISTIC_TOOLING).
  evaluatedCount: number;
};

/** Roll a case's probes up across its submissions' probe outcomes. Probes keep
 *  their declared order (the case's coverProbes order) so the heatmap reads the
 *  same as the internal probe list above it. */
export function probeMissHeatmap(probes: ProbeLike[], submissions: SubmissionLike[]): CohortProbeHeatmap {
  // Index every submission's outcomes by probeId once.
  const outcomesByProbe = new Map<string, OutcomeLike[]>();
  let evaluatedCount = 0;
  for (const sub of submissions) {
    if (sub.evaluation?.perStepSources?.tooling === DETERMINISTIC_TOOLING) continue;
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
    // weakRate is over the GRADED subset, not every evaluated outcome: an ungraded
    // (null) handledWell is "unknown", and counting it as not-handled-well reported
    // every Live Work Surface cohort — the path with the strongest evidence — as
    // 100 % weak on every probe, an adverse cohort finding manufactured from an
    // assessment that never ran. Same rule the eval panel's four probe states and
    // evaluate.py's judgment dimension already apply to this tri-state field.
    const graded = outcomes.filter((o) => o.handledWell === true || o.handledWell === false).length;
    cells.push({
      probeId: probe.id,
      kind: probe.kind ?? "probe",
      where: probe.where ?? "",
      reveals: probe.reveals ?? "",
      evaluated,
      detected,
      handledWell,
      graded,
      missRate: evaluated > 0 ? (evaluated - detected) / evaluated : null,
      weakRate: graded > 0 ? (graded - handledWell) / graded : null,
    });
  }

  return { cells, submissionCount: submissions.length, evaluatedCount };
}
