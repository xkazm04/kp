import type { GithubStatus } from "./AnalyzeTypes";

// bug-ui-scan-2026-07-09 (cv-analysis-workspace #3): Blind screening strips the
// candidate's identity (name, contact, gendered terms) from the CV before it is
// scored. The GitHub deep-dive is a PARALLEL client-side pipeline that renders
// the candidate's real GitHub identity — username, name, repositories — and it
// was never made blind-aware, so a recruiter who ticked Blind still saw identity
// beside the blind-scored CV. That silently defeats the anti-bias promise.
//
// The product rule, decided once here so both the submit path and the panel's
// retry honor it: in blind mode the GitHub deep-dive is SUPPRESSED (never POSTed,
// never rendered). A pure predicate so it can be unit-tested without React.
export function shouldRunGithubDeepDive(opts: { hasGithub: boolean; blind: boolean }): boolean {
  return opts.hasGithub && !opts.blind;
}

// Whether to show the "GitHub deep-dive is hidden in blind mode" note next to the
// GitHub field: the user supplied a handle but blind mode will skip it, so we say
// so up front instead of silently dropping the column.
export function shouldNoteBlindGithubSuppressed(opts: { hasGithub: boolean; blind: boolean }): boolean {
  return opts.hasGithub && opts.blind;
}

// Cancelling the MAIN CV run must also supersede a GitHub deep-dive still in
// flight, because a superseded run's guarded callbacks never fire — so a status
// left on "loading" sticks forever and keeps the Analyze button disabled
// (flags.githubLoading). That unsticking is the ONLY reason cancel() touches the
// GitHub status, and it applies to exactly one value.
//
// The deep-dive runs in PARALLEL with the CV pipeline and routinely finishes
// first, so at cancel time it may already have delivered a result ("done") or a
// retryable failure ("error"). Those are landed outcomes of a separate, already-
// paid-for call — resetting them to "idle" makes AnalyzeTab render nothing (its
// GitHub panel is gated on `githubStatus !== "idle"`), silently erasing a
// deep-dive the recruiter was already reading. Cancel halts the CV scan; it is
// not a reset (that is what reset() is for, and reset clears githubAnalysis too).
export function githubStatusAfterCancel(prev: GithubStatus): GithubStatus {
  return prev === "loading" ? "idle" : prev;
}
