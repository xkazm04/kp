// The group-eval modal's decision rules, extracted from useGroupEval / Notices so
// they can be pinned by tests (groupEvalSession.test.ts). They were inline in a
// hook body and a component body, i.e. reachable only through React — which is
// why the sealed merge, the "did the decision actually land" contract, the
// enriched/legacy threshold and the coverage-note exclusivity had no coverage at
// all. Nothing here touches React; the hook is the thin wrapper.
import type { EvalCandidate, GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

export type DecisionAction = "accept" | "reject";
export type DecidedMap = Record<string, DecisionAction>;

/** Session decisions plus the ones sealed OUTSIDE the click handler (a reject
 *  confirmed in the rationale dialog). Sealed WINS: those are already written to
 *  the pipeline and to the audit record, so a live button over one would invite a
 *  second act(). Returns the session map itself when nothing is sealed. */
export function mergeSealed(decided: DecidedMap, sealed?: DecidedMap | null): DecidedMap {
  return sealed ? { ...decided, ...sealed } : decided;
}

/** Builds the "record this click?" step of the decide handler.
 *
 *  Returns the action to record, or null when nothing must be recorded — either the
 *  identity was already decided (no second act()), or the pipeline refused it: the
 *  candidate has left the live pool, so the buttons stay live for a retry instead of
 *  flipping to a success pill for something that never happened. */
export function decideWith(decided: DecidedMap, onDecide: (identity: string, action: DecisionAction) => boolean) {
  return (identity: string, action: DecisionAction): DecisionAction | null => {
    if (decided[identity]) return null;
    return onDecide(identity, action) ? action : null;
  };
}

/** Enriched layout (the comparison table) only when the recruiter breakdown is
 *  actually present on at least one column; otherwise the compact legacy view, so
 *  legacy/simulation payloads and job-less roles still render. An EMPTY breakdown
 *  array is not a breakdown. */
export function isEnriched(candidates: EvalCandidate[]): boolean {
  return candidates.some((c) => (c.scoreBreakdown?.length ?? 0) > 0);
}

/** Which coverage sentence the modal owes the reader — mutually exclusive by
 *  construction (the server clears `capped` when a selection was used, but the
 *  precedence is stated here rather than assumed). */
export type CoverageNote = { kind: "selection"; count: number; total: number } | { kind: "capped"; cap: number; total: number } | null;

export function coverageNote(evaluation: GroupEvalPayload): CoverageNote {
  if (evaluation.selection) {
    return { kind: "selection", count: evaluation.selection.count, total: evaluation.selection.total };
  }
  if (evaluation.capped) {
    return { kind: "capped", cap: evaluation.cap ?? evaluation.candidates?.length ?? 0, total: evaluation.totalCandidates ?? 0 };
  }
  return null;
}
