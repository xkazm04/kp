// One case's postings, and the per-case intake counts the lifecycle list carries
// (challenge-r09 devcase-lifecycle/A).
//
// A SLICE of the dev-case store, not a section of devcase.ts - the devcase-ledger.ts
// precedent: devcase.ts sits on the import graph of every studio route and
// perf-budget.json caps each one. Only GET /api/devcase/[id]/channels and GET
// /api/devcase/lifecycle read this.
//
// Why it exists. The assignment detail used to receive the WORKSPACE's postings fold -
// every posting with every submission inlined, outcome-joined and promote-previewed - and
// filter it to one case in the browser; the lifecycle section folded the same fold down
// to two integers per case. Both questions are now answered in SQL, scoped to the case(s)
// asked about AND to the caller's workspace, never by a client-side filter.
//
// TENANCY: devcase-tenancy.test.ts scans devcase.ts; this file's statements are pinned by
// devcase-case-postings.test.ts, which asserts every dev table alias is filtered on its
// own workspace_id. Read-only: no read->write, so no lock strategy is owed.
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { inFlightAttemptsByPosting, type InFlightAttempts } from "./devcase-inflight";

/** A dev_postings row as the detail reads it. The same fields devcase.ts's rowToPosting
 *  maps (the test deep-equals a row against getPosting's), plus the submission count. */
export type CasePosting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  /** 'open' | 'closed' - the intake state the detail's channels must render honestly. */
  status: string;
  createdAt: string;
  submissionCount: number;
  workspaceId: string;
};

/** Every posting of `caseId` in `workspaceId`, newest first - the workspace route's
 *  order, so the two readers list a case's channels identically. */
export function listCasePostings(caseId: string, workspaceId: string): CasePosting[] {
  const rows = ensureDb()
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM dev_submissions s WHERE s.posting_id = p.id AND s.workspace_id = ?) AS submission_count
         FROM dev_postings p
        WHERE p.workspace_id = ? AND p.case_id = ?
        ORDER BY p.created_at DESC`
    )
    .all(workspaceId, workspaceId, caseId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as string,
    caseId: (r.case_id as string) ?? null,
    channel: r.channel as string,
    token: (r.token as string) ?? null,
    roleTitle: (r.role_title as string) ?? null,
    caseTitle: (r.case_title as string) ?? null,
    status: r.status as string,
    createdAt: r.created_at as string,
    workspaceId: ((r.workspace_id as string) ?? null) || DEFAULT_WORKSPACE_ID,
    submissionCount: Number(r.submission_count ?? 0),
  }));
}

export type CaseIntakeCounts = { submissionCount: number; inFlight: InFlightAttempts };

const zeroCounts = (): CaseIntakeCounts => ({ submissionCount: 0, inFlight: { live: 0, idle: 0, oldestLiveStartedAt: null } });

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/** caseId -> submissions summed across that case's postings, and the attempts mid-case on
 *  them right now (counts only - devcase-inflight.ts). Every asked-for id gets an entry,
 *  zeros when it has nothing, so a caller never reads an absence as a number. One GROUP BY
 *  for the submissions; the in-flight aggregate is folded from the per-posting read. */
export function caseIntakeCounts(caseIds: readonly string[], workspaceId: string): Map<string, CaseIntakeCounts> {
  const out = new Map<string, CaseIntakeCounts>();
  const ids = [...new Set(caseIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, zeroCounts());
  const db = ensureDb();
  const marks = ids.map(() => "?").join(", ");
  const postingRows = db
    .prepare(`SELECT p.id AS posting_id, p.case_id AS case_id FROM dev_postings p WHERE p.workspace_id = ? AND p.case_id IN (${marks})`)
    .all(workspaceId, ...ids) as Array<{ posting_id: string; case_id: string }>;
  if (postingRows.length === 0) return out;
  const submissionRows = db
    .prepare(
      `SELECT p.case_id AS case_id, COUNT(s.id) AS n
         FROM dev_postings p
         JOIN dev_submissions s ON s.posting_id = p.id AND s.workspace_id = ?
        WHERE p.workspace_id = ? AND p.case_id IN (${marks})
        GROUP BY p.case_id`
    )
    .all(workspaceId, workspaceId, ...ids) as Array<{ case_id: string; n: number }>;
  for (const r of submissionRows) out.get(r.case_id)!.submissionCount = Number(r.n);
  const inFlight = inFlightAttemptsByPosting(workspaceId);
  for (const { posting_id, case_id } of postingRows) {
    const agg = inFlight.get(posting_id);
    if (!agg) continue;
    const acc = out.get(case_id)!.inFlight;
    acc.live += agg.live;
    acc.idle += agg.idle;
    acc.oldestLiveStartedAt = earlier(acc.oldestLiveStartedAt, agg.oldestLiveStartedAt);
  }
  return out;
}
