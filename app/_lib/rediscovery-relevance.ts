// The relevance contract for the standing silver-medalist feed (idea-fdb45cd0),
// kept in its own IMPORT-FREE module so it's unit-testable under bare `node --test`
// (rediscover.ts pulls in better-sqlite3 + the @/ db barrel + python-runner, none
// of which load under the strip-types runner). Generic over the alert shape so it
// needs no type import — it only reads jobId/candidateId.

/** Drop alerts that have gone stale: the role was unpublished/closed, or the
 *  candidate has since been pipelined INTO that role (checked per the alert's own
 *  jobId, so being active elsewhere doesn't suppress it). State is injected so the
 *  contract is pure. */
export function filterRelevantAlerts<T extends { jobId: string; candidateId: string }>(
  alerts: T[],
  isPublished: (jobId: string) => boolean,
  isActiveInJob: (jobId: string, candidateId: string) => boolean
): T[] {
  return alerts.filter((a) => isPublished(a.jobId) && !isActiveInJob(a.jobId, a.candidateId));
}
