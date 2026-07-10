// The relevance contract for the standing silver-medalist feed (idea-fdb45cd0),
// kept in its own IMPORT-FREE module so it's unit-testable under bare `node --test`
// (rediscover.ts pulls in better-sqlite3 + the @/ db barrel + python-runner, none
// of which load under the strip-types runner). Generic over the alert shape so it
// needs no type import — it only reads jobId/candidateId. The one type import below
// is `import type` (fully erased at runtime), so this module still loads dep-free.
import type { ConsentSnapshot } from "./consent";

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

/** Reduce a candidate's per-ENTRY consent snapshots down to ONE effective
 *  snapshot for the durable CANDIDATE identity — the pure core of the
 *  cross-role outreach suppression gate (bug-ui-scan #1).
 *
 *  Consent + anonymization are stored per pipeline ENTRY (candidate×job), but a
 *  rediscovery "Reach out" re-contacts a PERSON under a DIFFERENT role, minting a
 *  fresh entry whose consent columns are blank. Reading that fresh entry alone
 *  reports "none" (contactable) even when the same person's ORIGINAL consent
 *  expired or they were anonymized/erased — silently defeating the suppression
 *  gate. Collapsing every entry for the candidate to one most-restrictive snapshot
 *  restores the person-level guarantee:
 *
 *   1. Anonymization is TERMINAL (PII scrubbed / Art.17 erasure). If ANY of the
 *      person's entries was anonymized, the person is anonymized — it wins over
 *      everything, mirroring consentStatus's own precedence.
 *   2. Otherwise the person's live consent is their MOST PERMISSIVE grant: a
 *      renewal on a newer role restores contactability. An open-ended grant (no
 *      expiry — the legacy "active" case) never lapses; otherwise take the LATEST
 *      expiry, so the person only reads as "expired" once EVERY grant has lapsed.
 *   3. A candidate with NO grant on ANY entry (recruiter-sourced, never applied)
 *      resolves to "none" — contactable, exactly as an entry-level read would.
 *
 *  Pure and `now`-free (the expiry is judged by consentStatus/outreachSuppression
 *  downstream), so it stays unit-testable under the strip-types runner. */
export function resolveCandidateConsent(snaps: ConsentSnapshot[]): ConsentSnapshot {
  const none: ConsentSnapshot = { givenAt: null, expiresAt: null, anonymizedAt: null };
  if (snaps.length === 0) return none;

  const anonymized = snaps.find((s) => s.anonymizedAt);
  if (anonymized) return { givenAt: null, expiresAt: null, anonymizedAt: anonymized.anonymizedAt };

  const grants = snaps.filter((s) => s.givenAt);
  if (grants.length === 0) return none; // recruiter-sourced only — no consent on file
  // An open-ended grant (given, no expiry) is legacy "active" and never expires —
  // the most permissive window, so it wins.
  const openEnded = grants.find((s) => !s.expiresAt);
  if (openEnded) return { givenAt: openEnded.givenAt, expiresAt: null, anonymizedAt: null };
  // Otherwise the person's window is the LATEST expiry across their grants.
  let latest = grants[0];
  for (const s of grants) {
    if (Date.parse(s.expiresAt as string) > Date.parse(latest.expiresAt as string)) latest = s;
  }
  return { givenAt: latest.givenAt, expiresAt: latest.expiresAt, anonymizedAt: null };
}
