import { ensureDb } from "./core";

// Who is mid-case right now, per posting (challenge-r06 devcase-session-api/B).
//
// The close door wraps up everyone who SUBMITTED and flips the posting closed; before
// this projection nothing in the store counted the attempts still in flight, so a
// recruiter closed an intake over candidates an hour into a timeboxed case without being
// told. This is the read the postings GET carries to the close confirm.
//
// COUNTS ONLY. The studio needs "how many, and for how long", never who: no session id
// and no session candidate_ref leaves this function, so the recruiter surface gains no
// handle on an attempt it could not already see as a submission.
//
// LIVE vs IDLE: a session's `updated_at` moves only when the flush lands real events or
// a dirty tree (appendDevSessionEvents / saveDevSessionFiles), so it is the candidate's
// last activity, not the page's heartbeat. Active and touched inside LIVE_WINDOW_MS is
// someone working; active and older is an abandoned tab, which a close costs nothing and
// which must not raise the alarm.
//
// A session belongs to a posting through its apply token (dev_sessions.token =
// dev_postings.token). Both sides are pinned to the workspace as predicates: a session
// inherits its posting's workspace at mint, and checking both keeps a stray row from
// ever crossing a tenant.

export const LIVE_WINDOW_MS = 30 * 60_000;

export type InFlightAttempts = {
  /** Active and active within the live window: someone is working right now. */
  live: number;
  /** Active but quiet past the window: most likely an abandoned attempt. */
  idle: number;
  /** created_at of the longest-running LIVE attempt; null when none is live. */
  oldestLiveStartedAt: string | null;
};

export const NO_IN_FLIGHT: InFlightAttempts = Object.freeze({ live: 0, idle: 0, oldestLiveStartedAt: null }) as InFlightAttempts;

/** postingId -> in-flight aggregate for every posting of `workspaceId` with at least one
 *  active session. A posting absent from the map has none ({@link NO_IN_FLIGHT}). */
export function inFlightAttemptsByPosting(
  workspaceId: string,
  nowMs: number = Date.now(),
  liveWindowMs: number = LIVE_WINDOW_MS
): Map<string, InFlightAttempts> {
  const rows = ensureDb()
    .prepare(
      `SELECT p.id AS posting_id, s.created_at AS created_at, s.updated_at AS updated_at
         FROM dev_sessions s
         JOIN dev_postings p ON p.token = s.token
        WHERE p.workspace_id = ? AND s.workspace_id = ? AND s.status = 'active'`
    )
    .all(workspaceId, workspaceId) as Array<{ posting_id: string; created_at: string; updated_at: string | null }>;

  const out = new Map<string, InFlightAttempts>();
  for (const r of rows) {
    const agg = out.get(r.posting_id) ?? { live: 0, idle: 0, oldestLiveStartedAt: null };
    const touched = Date.parse(r.updated_at ?? r.created_at);
    if (Number.isFinite(touched) && nowMs - touched <= liveWindowMs) {
      agg.live += 1;
      if (agg.oldestLiveStartedAt === null || Date.parse(r.created_at) < Date.parse(agg.oldestLiveStartedAt)) {
        agg.oldestLiveStartedAt = r.created_at;
      }
    } else {
      agg.idle += 1;
    }
    out.set(r.posting_id, agg);
  }
  return out;
}
