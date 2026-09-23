import { pipelineCalibrationPairs } from "./db/pipeline";
import { heldOutEntryIds } from "./decision-record-store";
import { recommendScreeningThreshold, type ThresholdRecommendation } from "./calibration";
import { getDecisionConfig, type ScreeningRule } from "./decision-config-store";
import { effectiveFloor } from "./decision-config-schema";

// The LIVE screening-floor recommendation, derived in ONE place.
//
// Three routes need the same number: the calibration read that DISPLAYS it
// (/api/analytics/calibration), the write that APPLIES it (/apply-threshold) and the
// preview that names who it moves on today's board (/floor-preview). Each used to carry
// its own inline copy of "pairs in scope + clean-arm below-floor band + the effective
// floor -> recommendScreeningThreshold", and a preview that re-derived a third time
// could show a different threshold than the one Apply writes. It cannot now: all three
// call this.
//
// RATCHET GUARD, restated where it lives: the below-floor half comes from the CLEAN ARM
// (entries the wave spared), filtered to the SAME family scope as the pairs. No clean
// arm means no recommendation, never a contaminated one.
//
// `deps` lets the display route hand over what it has already read for the same
// request (its advance-axis pairs, its memoised clean-arm id set, its screening rule)
// so extracting the derivation costs that route no second scan.

type ScopedPair = ReturnType<typeof pipelineCalibrationPairs>[number];

export type LiveScreeningRecommendation = {
  recommendation: ThresholdRecommendation | null;
  /** The effective floor the recommendation was measured against (family override, else global). */
  currentThreshold: number;
  /** The rule that floor was read from, so a caller can act on the same snapshot. */
  screening: ScreeningRule;
};

export function liveScreeningRecommendation(
  workspaceId: string,
  roleFamily: string | null,
  deps?: { allPairs?: readonly ScopedPair[]; heldOut?: () => Set<string>; screening?: ScreeningRule }
): LiveScreeningRecommendation {
  const screening = deps?.screening ?? getDecisionConfig<ScreeningRule>("screening", workspaceId);
  const currentThreshold = effectiveFloor(screening, roleFamily);
  const allPairs = deps?.allPairs ?? pipelineCalibrationPairs(workspaceId, { outcome: "advance" });
  const pairs = roleFamily ? allPairs.filter((p) => p.roleFamily === roleFamily) : [...allPairs];
  const heldOut = deps?.heldOut ? deps.heldOut() : heldOutEntryIds(workspaceId);
  const allHoldout = pipelineCalibrationPairs(workspaceId, { onlyEntryIds: heldOut, outcome: "advance" });
  const holdoutPairs = roleFamily ? allHoldout.filter((p) => p.roleFamily === roleFamily) : allHoldout;
  return { recommendation: recommendScreeningThreshold(pairs, holdoutPairs, currentThreshold), currentThreshold, screening };
}
