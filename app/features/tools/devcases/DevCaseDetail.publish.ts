// Publish-gate logic for CaseDetail, extracted as pure TS so it is unit-testable
// (the .tsx can't be loaded by node --test). Publishing a case is effectively
// IRREVERSIBLE from this surface — it mints a live candidate-facing apply token and
// (via the lifecycle) proactively sources real candidates into the pipeline — so it
// always needs an explicit confirm step; a case flagged DEGRADED (interview scenario
// fell back to template probes, or the seed is a prose-only skeleton) additionally
// needs a deliberate "publish anyway" acknowledgement, because those are exactly the
// cases that should not ship to candidates.
// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #3).

export type PublishGateInput = { scenarioDegraded: boolean; seedDegraded: boolean };

/** Whether the case is in a known-degraded state at publish time. */
export function isDegradedPublish(input: PublishGateInput): boolean {
  return input.scenarioDegraded || input.seedDegraded;
}

/** Whether the confirm dialog's primary "publish" action may fire. A healthy case
 *  only needs the confirm step (the dialog being open IS the confirmation); a degraded
 *  case additionally requires the explicit acknowledgement checkbox to be ticked. */
export function canConfirmPublish(input: {
  scenarioDegraded: boolean;
  seedDegraded: boolean;
  acknowledgedDegraded: boolean;
}): boolean {
  return isDegradedPublish(input) ? input.acknowledgedDegraded : true;
}

/** The reasons the assignment is degraded, as CODES rather than prose.
 *
 *  This module is pure TS with no reader attached, so the two sentences it used to
 *  return were English shipped into a four-locale product — and they were also the
 *  last place on this surface that still called the entity a "case", where neither
 *  the catalog walk nor the source guard in devcase-vocabulary.test.ts could see
 *  them. The confirm dialog resolves each code through
 *  `devcase.studio.degradedReason.<code>` in the reader's own language.
 *  Empty when the assignment is healthy. */
export const DEGRADED_REASONS = ["scenario", "seed"] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

export function degradedReasons(input: PublishGateInput): DegradedReason[] {
  const reasons: DegradedReason[] = [];
  if (input.scenarioDegraded) reasons.push("scenario");
  if (input.seedDegraded) reasons.push("seed");
  return reasons;
}
