import type { GithubStatus } from "./AnalyzeTypes";

// The intake form auto-collapses once a run lands (to make room for the result
// panels) and auto-expands again once the view settles back to idle. This is
// the single pure decision behind that behavior so it can be unit-tested without
// a render layer.
//
// The bug this guards (bug-ui-scan-2026-07-09 #1): when a run supplies BOTH a CV
// and a GitHub handle and the CV pipeline fails, the CV error is rendered ONLY in
// the expanded form's aria-live slot. The naive `hasResult` treated the live
// GitHub run as a result, pinned the form collapsed, and the collapsed view has
// no error slot — so a failed CV analysis surfaced nowhere. The invariant here:
// a CV error is NOT a result, so it forces the form back to idle (re-expanded),
// where the error is always reachable, regardless of a parallel GitHub run.
export interface AnalyzeRunSnapshot {
  /** flags.isLoading || flags.isCompleting — the MAIN CV run is in flight. */
  isAnalyzing: boolean;
  /** result.analysis !== null — a CV analysis has landed. */
  hasAnalysis: boolean;
  /** result.githubStatus — the parallel client-side GitHub deep-dive. */
  githubStatus: GithubStatus;
  /** result.error !== null — the CV pipeline failed (AnalyzeError / bad payload). */
  cvError: boolean;
}

export interface AnalyzeCollapseDecision {
  /**
   * Whether a landed result should keep the intake form collapsed. A CV error is
   * deliberately NOT a result: it forces this false so the form re-expands and
   * its error slot surfaces the failure — even when a parallel GitHub run
   * succeeded and would otherwise pin this truthy.
   */
  hasResult: boolean;
  /**
   * The settled/idle state that drives auto-expand. idle === true re-expands the
   * form (so a CV error is always reachable); idle === false keeps it collapsed
   * to make room for the result panels.
   */
  idle: boolean;
}

export function deriveCollapseDecision(s: AnalyzeRunSnapshot): AnalyzeCollapseDecision {
  // A CV error is not a result — never let it (or a co-running GitHub result)
  // keep the form collapsed, so the error slot in the expanded form is reached.
  const hasResult = s.cvError ? false : s.hasAnalysis || s.githubStatus !== "idle";
  const idle = !s.isAnalyzing && !hasResult;
  return { hasResult, idle };
}
