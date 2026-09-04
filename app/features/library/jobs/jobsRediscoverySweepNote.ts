// What a rediscovery sweep should SAY it did — pure, so the claim is pinned by
// jobsRediscoverySweepNote.test.ts rather than asserted in a comment.
//
// POST /api/rediscovery/alerts answers `{ jobsSwept, newAlerts, truncated,
// failedJobs }`, and the feed read the first two: a sweep whose rankings all died
// reported the identical, reassuring "Checked 3 roles: 0 new matches" as a sweep
// that ran perfectly and found nobody. Same failure shape as `sourcingWarning` on
// publish — "found nothing" and "could not look" are different answers to the
// question the recruiter is actually asking, and only one of them is green.

/** A sweep line: which message to render, its ICU arguments, and the tone it must
 *  be painted in. The producer declares the tone — inferring it at the render site
 *  from a string comparison is how a failure ends up in the "it worked" colour. */
export type SweepNote = {
  /** `jobs.rediscoveryFeed` message keys, in render order. */
  keys: ("noPublished" | "swept" | "sweptIncomplete")[];
  jobs: number;
  found: number;
  failed: number;
  tone: "ok" | "error";
};

export type SweepBody = {
  jobsSwept?: number;
  newAlerts?: number;
  failedJobs?: number;
};

export function sweepNote(body: SweepBody): SweepNote {
  const jobs = body.jobsSwept ?? 0;
  const found = body.newAlerts ?? 0;
  // Clamped at the roles actually swept: a `failedJobs` larger than `jobsSwept`
  // could only be a server bug, and "4 of 3 roles failed" reads as a broken app on
  // top of a broken sweep.
  const failed = Math.max(0, Math.min(body.failedJobs ?? 0, jobs));
  // Nothing published to check against is neither success nor failure — it is the
  // pre-condition, and it was already its own line.
  if (jobs === 0) return { keys: ["noPublished"], jobs, found, failed: 0, tone: "ok" };
  if (failed === 0) return { keys: ["swept"], jobs, found, failed, tone: "ok" };
  // A PARTIAL failure still reports what did land — the alerts that were raised are
  // real and actionable — but the note is an error, because the list below it is
  // incomplete by an amount the recruiter cannot see from the list itself.
  return { keys: ["swept", "sweptIncomplete"], jobs, found, failed, tone: "error" };
}
