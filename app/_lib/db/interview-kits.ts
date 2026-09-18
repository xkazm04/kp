import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import type { InterviewKit, StoredInterviewKit } from "../interview-kit-types";

// The job-level interview kit store (spark interview-kit-template, WP-A).
//
// One row per VERSION of one job's kit. The table is APPEND-ONLY: an edit inserts a new
// version, a regeneration inserts a new version, and nothing ever rewrites a version's
// `kit_json`. The reasoning is the same one `agent_fit_specs` carries (db/core.ts) plus
// the half that is specific to interviews: a candidate's link is PINNED to the version it
// was minted with, so two candidates in one round are asked the same things and their
// ratings stay comparable. Rewriting a version in place would retroactively change what
// an interview that already happened had asked.
//
// The ONE UPDATE in this file is `interviewKitPublish`, a status flip from 'draft' to
// 'published'. It is allowed precisely because it does not touch `kit_json`: it says
// which version NEW links mint from, not what any version asks. See the DDL comment.
//
// NO CANDIDATE DATA LIVES HERE, and this is a hard rule rather than a convention. The
// GDPR erasure scrub is entry-keyed — `scrubEntryLinkedPii` (db/pipeline.ts) walks an
// entry's preps, interviews, events and offers — so it has no path to a JOB-keyed row. A
// candidate name pasted into a question, or a probe derived from one person's CV, would
// therefore be undeletable by design. Per-candidate material belongs in
// `interview_preps`, which the scrub does blank. `interview-kits-shape.test.ts` pins the
// persisted shape so the rule is checked rather than remembered.
//
// TENANCY: every statement binds `workspace_id`, point reads included, with NO by-id
// carve-out. A kit is an operator-authored artifact with no public token, and the by-id
// read is what a MINTED LINK resolves — so a leaked kit id must not hand another team the
// questions they wrote (interview-kits-tenancy.test.ts, whose exemption list is empty).
//
// NAMES are module-prefixed (`interviewKit*`) on purpose: the route-layer tenancy ratchet
// matches store functions BY TEXT across the api tree, so a store that exported a generic
// `getLatest` would be indistinguishable from any other module's.

export type StoredInterviewKitSummary = Omit<StoredInterviewKit, "kit">;

type InterviewKitRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  version: number;
  status: string;
  kit_json: string;
  source: string;
  created_at: string;
};

/** A row whose `kit_json` is unreadable degrades to null rather than throwing: one
 *  corrupt version must not take down the version list beside it (safeRowParse logs it
 *  server-side, the same per-row degradation `getJob` takes). */
function rowToKit(r: InterviewKitRow): StoredInterviewKit | null {
  const kit = safeRowParse<InterviewKit>(r.kit_json, "interviewKit.kit", r.id);
  if (!kit || typeof kit !== "object") return null;
  return { ...rowToSummary(r), kit };
}

/** The columns a summary needs — every row column except the payload, so the version
 *  list can be read without pulling eight kits' worth of questions into memory. */
type InterviewKitSummaryRow = Omit<InterviewKitRow, "kit_json">;

function rowToSummary(r: InterviewKitSummaryRow): StoredInterviewKitSummary {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    jobId: r.job_id,
    version: r.version,
    // The CHECK constraints make these closed at the DB level; narrowed here so a row
    // written by an older build can never widen the type its readers rely on.
    status: r.status === "published" ? "published" : "draft",
    source: r.source === "edited" ? "edited" : "generated",
    createdAt: r.created_at,
  };
}

/**
 * Append a new version of a job's kit.
 *
 * The version number is the read→compute→write this store is built around, so it runs
 * inside an IMMEDIATE transaction: the write lock is taken at BEGIN, which is what makes
 * "MAX(version) + 1" a fact rather than a guess when two recruiters save at once. (The
 * UNIQUE index is the second line of defence, not the first — a colliding INSERT would
 * throw, and a save that throws is a save the recruiter has to redo.) Nothing is awaited
 * between BEGIN and COMMIT; better-sqlite3 is synchronous and an await here would silently
 * end the atomicity (.claude/CLAUDE.md).
 */
export function interviewKitAppendVersion(
  input: { jobId: string; kit: InterviewKit; source: StoredInterviewKit["source"]; status?: StoredInterviewKit["status"] },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StoredInterviewKit {
  const db = ensureDb();
  const id = randomId("ikit");
  const now = new Date().toISOString();
  const status = input.status ?? "draft";
  const kitJson = JSON.stringify(input.kit);
  const version = db.transaction((): number => {
    const row = db
      .prepare(`SELECT MAX(version) AS v FROM interview_kits WHERE workspace_id = ? AND job_id = ?`)
      .get(workspaceId, input.jobId) as { v: number | null } | undefined;
    const next = (row?.v ?? 0) + 1;
    db.prepare(
      `INSERT INTO interview_kits (id, workspace_id, job_id, version, status, kit_json, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, workspaceId, input.jobId, next, status, kitJson, input.source, now);
    return next;
  }).immediate();
  return { id, workspaceId, jobId: input.jobId, version, status, kit: input.kit, source: input.source, createdAt: now };
}

/** The highest PUBLISHED version for a job in this team, or null when the job has no
 *  published kit. This is what a NEW candidate link mints from; an already-minted link
 *  keeps reading the version it pinned, through `interviewKitById`. Ordered by `version`
 *  and not `created_at`: a generated draft published a moment later shares its ISO
 *  millisecond, and "latest" must not be decided by a tie-break (the intermittent failure
 *  `getLatestAgentFitSpec` documents). */
export function interviewKitLatestPublished(
  jobId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StoredInterviewKit | null {
  const row = ensureDb()
    .prepare(
      `SELECT * FROM interview_kits
        WHERE workspace_id = ? AND job_id = ? AND status = 'published'
        ORDER BY version DESC LIMIT 1`
    )
    .get(workspaceId, jobId) as InterviewKitRow | undefined;
  return row ? rowToKit(row) : null;
}

/** The highest DRAFT version for a job — what the editor opens, and where a fresh
 *  generation lands. Null when every version has been published. */
export function interviewKitLatestDraft(
  jobId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StoredInterviewKit | null {
  const row = ensureDb()
    .prepare(
      `SELECT * FROM interview_kits
        WHERE workspace_id = ? AND job_id = ? AND status = 'draft'
        ORDER BY version DESC LIMIT 1`
    )
    .get(workspaceId, jobId) as InterviewKitRow | undefined;
  return row ? rowToKit(row) : null;
}

/** ONE stored version by id — what a MINTED LINK pinned, which may be older than the
 *  latest published one. Workspace-bound with no carve-out (see the header). */
export function interviewKitById(kitId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): StoredInterviewKit | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM interview_kits WHERE id = ? AND workspace_id = ?`)
    .get(kitId, workspaceId) as InterviewKitRow | undefined;
  return row ? rowToKit(row) : null;
}

/** Every version of a job's kit, newest first, WITHOUT the payloads. The history panel
 *  needs "which versions exist and what are they", not eight kits' worth of questions;
 *  a reader that wants one of them fetches it by id. */
export function interviewKitVersions(
  jobId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): StoredInterviewKitSummary[] {
  const rows = ensureDb()
    .prepare(
      `SELECT id, workspace_id, job_id, version, status, source, created_at
         FROM interview_kits
        WHERE workspace_id = ? AND job_id = ?
        ORDER BY version DESC`
    )
    .all(workspaceId, jobId) as InterviewKitSummaryRow[];
  return rows.map(rowToSummary);
}

/**
 * Flip one DRAFT version to published — the only UPDATE this table permits, and only
 * because it leaves `kit_json` alone (db/core.ts states the argument).
 *
 * `status = 'draft'` is in the WHERE, not checked beforehand: the read and the write are
 * one statement, so a second publish racing the first changes 0 rows and answers
 * "already published" instead of both callers believing they did it. Returns the
 * published version, or null when the id is unknown to this team or was already
 * published — the caller re-reads to tell those apart, which is the honest shape for a
 * door that must not become an existence oracle.
 */
export function interviewKitPublish(kitId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): StoredInterviewKit | null {
  const res = ensureDb()
    .prepare(`UPDATE interview_kits SET status = 'published' WHERE id = ? AND workspace_id = ? AND status = 'draft'`)
    .run(kitId, workspaceId);
  if (res.changes === 0) return null;
  return interviewKitById(kitId, workspaceId);
}
