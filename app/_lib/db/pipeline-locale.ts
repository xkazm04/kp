// The candidate's OWN language choice (the /stop/[token] page's language control).
// A leaf beside db/pipeline.ts, imported only by the stop door. The READ that later inference
// needs lives in comms-locale.ts (chosenLocaleForCandidate) so hot route graphs gain no module.
import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The token's entry, or any entry of the same non-empty candidate_id in the same team.
const PERSON = `(id = ? OR (candidate_id <> '' AND candidate_id = (SELECT candidate_id FROM pipeline_entries WHERE id = ? AND workspace_id = ?)))`;

/** Store `locale` + `locale_chosen_at` on the entry and the same person's other entries
 *  in `workspaceId` (the TOKEN row's tenant, never a session); an empty candidate_id
 *  changes alone, an erased row takes nothing. One UPDATE, last choice wins: no
 *  read→write to lock. Returns the rows changed (0 = the entry is gone). */
export function setCandidateChosenLocale(entryId: string, locale: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const now = new Date().toISOString();
  return ensureDb()
    .prepare(
      `UPDATE pipeline_entries SET locale = ?, locale_chosen_at = ?, updated_at = ? WHERE workspace_id = ? AND anonymized_at IS NULL AND ${PERSON}`
    )
    .run(locale, now, now, workspaceId, entryId, entryId, workspaceId).changes;
}

/** Whether the person behind this entry has stated a language (its own stamp or a
 *  same-person sibling's: an entry filed after the choice carries the locale, not the stamp). */
export function entryLocaleChosen(entryId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  return (
    ensureDb()
      .prepare(`SELECT 1 FROM pipeline_entries WHERE workspace_id = ? AND locale_chosen_at IS NOT NULL AND ${PERSON} LIMIT 1`)
      .get(workspaceId, entryId, entryId, workspaceId) != null
  );
}
