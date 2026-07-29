// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #4): the state transition
// for a RediscoveryFeed "+ pipeline" click. The bug: on success the feed marked the
// candidate added AND dismissed the row in the SAME render tick, so the row was
// filtered out of `alerts` before its green "Added ✓" branch could ever render — the
// badge was dead code and the row silently vanished with no confirmation. This pure
// transition records the success in `added` (lighting the badge) and reports a
// DEFERRED dismiss, so the component keeps the row for a beat, shows the badge, then
// dismisses — matching RediscoverPanel / RecruiterCandidates. On failure the row
// keeps its error and is never dismissed.
export type PipelineAddResult = { ok: true } | { ok: false; message: string };

export type AddFlowState = {
  added: ReadonlySet<string>;
  rowError: ReadonlyMap<string, string>;
};

export type AddFlowNext = {
  added: Set<string>;
  rowError: Map<string, string>;
  // "deferred" — keep the row (badge visible), dismiss after a beat.
  // "none"     — a failed add: keep the row with its error, never dismiss.
  dismiss: "deferred" | "none";
};

// How long the "Added ✓" badge stays before the row auto-dismisses (ms). Single
// source so the component and any future consumer agree on the beat.
export const ADDED_BADGE_MS = 1200;

export function applyAddResult(
  prev: AddFlowState,
  candidateId: string,
  result: PipelineAddResult
): AddFlowNext {
  const added = new Set(prev.added);
  const rowError = new Map(prev.rowError);
  if (result.ok) {
    added.add(candidateId);
    rowError.delete(candidateId); // a retry that succeeds clears the prior error
    return { added, rowError, dismiss: "deferred" };
  }
  rowError.set(candidateId, result.message);
  return { added, rowError, dismiss: "none" };
}
