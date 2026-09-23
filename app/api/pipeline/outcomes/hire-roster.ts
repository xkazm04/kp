// challenge-r07 pipeline-api/B — the workspace's current hires, read as a roster.
//
// The Quality counter used to answer "how many hires" by hydrating the whole active
// board through the board read (capped at PIPELINE_BOARD_CAP, every row through
// rowToEntry: github JSON, notes, source attribution) only to keep a length. This asks
// SQLite the question instead: the active rows standing on this workspace's
// terminal-role column(s), projected to what the rating queue needs, uncapped — the
// queue caps its own rows and reports the total beside them.
//
// Route-local on purpose: db/pipeline.ts is in other in-flight write sets, and this is
// a read that only the outcomes route makes. The tenant is a REQUIRED parameter (no
// DEFAULT_WORKSPACE_ID fallback), so a caller that forgets it fails typecheck rather
// than reading another team's hires.
import { ensureDb } from "@/app/_lib/db/core";
import { TERMINAL_STATUS_SQL_LIST } from "@/app/_lib/db/pipeline-core";
import { hireOutcomeRef } from "@/app/_lib/dev-outcomes";
import type { HireRosterRow } from "@/app/_lib/hire-rating-queue";

type RosterSqlRow = {
  id: string;
  candidate_id: string | null;
  dev_submission_id: string | null;
  candidate_label: string;
  job_title: string | null;
  stage_changed_at: string | null;
};

/** Active entries (not rejected / declined / rematched / role-closed) on one of
 *  `terminalStageIds` in `workspaceId`, each with the dev_outcomes ref its rating is
 *  keyed by. `terminalStageIds` is the workspace's own axis (stagesWithRole
 *  "terminal"), never the shipped literal "Hired": a team that renamed its last
 *  column still gets its hires, and a row stranded on a column literally called
 *  "Hired" that this axis does not carry is not one. */
export function listWorkspaceHires(workspaceId: string, terminalStageIds: readonly string[]): HireRosterRow[] {
  if (terminalStageIds.length === 0) return [];
  const placeholders = terminalStageIds.map(() => "?").join(", ");
  const rows = ensureDb()
    .prepare(
      `SELECT id, candidate_id, dev_submission_id, candidate_label, job_title, stage_changed_at
       FROM pipeline_entries
       WHERE workspace_id = ? AND stage IN (${placeholders}) AND status NOT IN ${TERMINAL_STATUS_SQL_LIST}`
    )
    .all(workspaceId, ...terminalStageIds) as RosterSqlRow[];
  return rows.map((r) => ({
    entryId: r.id,
    ref: hireOutcomeRef({ id: r.id, candidateId: r.candidate_id, devSubmissionId: r.dev_submission_id }),
    candidateLabel: r.candidate_label,
    jobTitle: r.job_title,
    hiredAt: r.stage_changed_at,
  }));
}
