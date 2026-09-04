/** Pure derivations behind the job-fit tab. Extracted from JobFitTab.tsx so the
 *  arithmetic that decides what a recruiter is told about a TRUNCATED list is
 *  reachable by a test (jobFitView.test.ts beside it). */

/** Entries the server-side display cap dropped: total minus what was sent.
 *
 *  A missing total (null/undefined) means the analysis predates total-tracking
 *  (see KeywordCoverage in pipeline/jobfit/models.py) — treat as "unknown" and
 *  answer 0, so the UI shows nothing rather than inventing a gap. A total below
 *  what was shown is a nonsense payload; clamp instead of rendering "+-3 more".
 */
export function hiddenByCap(total: number | null | undefined, shown: number): number {
  return total == null ? 0 : Math.max(0, total - shown);
}
