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
