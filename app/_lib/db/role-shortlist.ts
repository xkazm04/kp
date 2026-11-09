// The role SHORTLIST (ADR 0030, triage T14): which people a human ticked "shortlisted" or
// marked "chosen" on a role, who did it and when. One row per (workspace, role, entry).
//
// HUMAN-SET ONLY. The single writer is POST /api/decisions/shortlist, behind a signed-in
// operator with the pipeline:write seat. No automation, agent, scorer or LLM path imports
// setShortlistState (role-shortlist-human-only.test.ts greps for it). The actor token is
// supplied by that route from the session, never from the request body.
//
// Tenancy: `role_shortlist` is workspace-scoped; EVERY statement here binds workspace_id,
// point reads included. The only other writer is the erasure scrub in db/pipeline.ts, which
// deletes a candidate's rows with them.
import { ensureDb } from "./core";
import { getPipelineEntry } from "./pipeline";

export const SHORTLIST_STATES = ["shortlisted", "chosen"] as const;
export type ShortlistState = (typeof SHORTLIST_STATES)[number];
export const isShortlistState = (v: unknown): v is ShortlistState => typeof v === "string" && (SHORTLIST_STATES as readonly string[]).includes(v);

export type ShortlistRow = { entryId: string; state: ShortlistState; setBy: string; setAt: string };

type Row = { entry_id: string; state: ShortlistState; set_by: string; set_at: string };

/** Every marked person on one role. */
export function listRoleShortlist(workspaceId: string, jobId: string): ShortlistRow[] {
  const rows = ensureDb()
    .prepare(`SELECT entry_id, state, set_by, set_at FROM role_shortlist WHERE workspace_id = ? AND job_id = ? ORDER BY set_at, entry_id`)
    .all(workspaceId, jobId) as Row[];
  return rows.map((r) => ({ entryId: r.entry_id, state: r.state, setBy: r.set_by, setAt: r.set_at }));
}

export type SetShortlistResult = { ok: true; row: ShortlistRow | null } | { ok: false; code: "entry_unknown" };

/** Set (or, with state null, clear) one person's mark. The entry must be in this workspace
 *  and on this role: a foreign or mismatched id changes nothing. */
export function setShortlistState(args: {
  workspaceId: string;
  jobId: string;
  entryId: string;
  state: ShortlistState | null;
  actor: string;
}): SetShortlistResult {
  const { workspaceId, jobId, entryId, state, actor } = args;
  const entry = getPipelineEntry(entryId, workspaceId);
  if (!entry || entry.jobId !== jobId) return { ok: false, code: "entry_unknown" };
  const db = ensureDb();
  if (state === null) {
    db.prepare(`DELETE FROM role_shortlist WHERE workspace_id = ? AND job_id = ? AND entry_id = ?`).run(workspaceId, jobId, entryId);
    return { ok: true, row: null };
  }
  const setAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO role_shortlist (workspace_id, job_id, entry_id, state, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, job_id, entry_id) DO UPDATE SET state = excluded.state, set_by = excluded.set_by, set_at = excluded.set_at`
  ).run(workspaceId, jobId, entryId, state, actor, setAt);
  return { ok: true, row: { entryId, state, setBy: actor, setAt } };
}
