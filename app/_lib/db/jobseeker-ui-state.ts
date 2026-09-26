import { COVER_NOTE_MAX_CHARS, COVER_NOTES_KEPT } from "../jobseeker/types";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The seeker's small UI state that has to follow them from one browser to the next
// (docs/features/jobseeker/README.md): the designed-CV choices and a cover-note draft per
// posting. Both used to live in the browser (localStorage / sessionStorage), which lost
// them on another device, and the cover note whenever the tab closed.
//
// One keyed table rather than a JSON column on the profile row: a cover note is written
// on every pause in typing, and a column holding up to COVER_NOTES_KEPT of them would be
// read whole by every profile load and rewritten whole by every keystroke pause. Here a
// write touches one (profile, kind, key) row — an ON CONFLICT on the primary key, which
// is never NULL because a profile id always is one.
//
// Tenancy: every statement binds `workspace_id = ?` (jobseeker-ui-state-tenancy.test.ts),
// and the profile id comes from the session's own profile in the route, never the body.

export const UI_STATE_KINDS = ["cv_design", "cover_note"] as const;
export type UiStateKind = (typeof UI_STATE_KINDS)[number];

/** A stored value with the time it was written. */
export type UiStateEntry<T> = { value: T; updatedAt: string };

type Row = { key: string; value_json: string; updated_at: string };

function entryOf<T>(row: Row | undefined, label: string): UiStateEntry<T> | null {
  if (!row) return null;
  const value = safeRowParse<T>(row.value_json, label, row.key);
  return value === null || value === undefined ? null : { value, updatedAt: row.updated_at };
}

function put(profileId: string, kind: UiStateKind, key: string, value: unknown, workspaceId: string): string {
  const now = new Date().toISOString();
  ensureDb()
    .prepare(
      `INSERT INTO jobseeker_ui_state (workspace_id, profile_id, kind, key, value_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (workspace_id, profile_id, kind, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(workspaceId, profileId, kind, key, JSON.stringify(value), now);
  return now;
}

/** The designed-CV choices as last saved, or null. The value is whatever the route
 *  validated on the way in; readers re-validate (cvQuery.ts parseCvDesign). */
export function getCvDesignState(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): UiStateEntry<Record<string, unknown>> | null {
  const row = ensureDb()
    .prepare(`SELECT key, value_json, updated_at FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'cv_design' AND key = ''`)
    .get(workspaceId, profileId) as Row | undefined;
  return entryOf<Record<string, unknown>>(row, "jobseekerUiState.cvDesign");
}

export function setCvDesignState(profileId: string, design: Record<string, unknown>, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  return put(profileId, "cv_design", "", design, workspaceId);
}

/** The cover-note draft the seeker kept for one posting, or null (never edited). */
export function getCoverNote(profileId: string, postingId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): UiStateEntry<string> | null {
  const row = ensureDb()
    .prepare(`SELECT key, value_json, updated_at FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'cover_note' AND key = ?`)
    .get(workspaceId, profileId, postingId) as Row | undefined;
  const entry = entryOf<unknown>(row, "jobseekerUiState.coverNote");
  return entry && typeof entry.value === "string" ? { value: entry.value, updatedAt: entry.updatedAt } : null;
}

/** Keep a cover-note draft. The text is capped at COVER_NOTE_MAX_CHARS (the route
 *  refuses longer, this is the store's own bound), and past COVER_NOTES_KEPT notes the
 *  least recently written are dropped — in the same IMMEDIATE transaction, so two tabs
 *  saving at once cannot both skip the prune. */
export function setCoverNote(profileId: string, postingId: string, text: string, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  const d = ensureDb();
  const run = d.transaction((): string => {
    const at = put(profileId, "cover_note", postingId, text.slice(0, COVER_NOTE_MAX_CHARS), workspaceId);
    d.prepare(
      `DELETE FROM jobseeker_ui_state
       WHERE workspace_id = ? AND profile_id = ? AND kind = 'cover_note'
         AND key NOT IN (
           SELECT key FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'cover_note'
           ORDER BY updated_at DESC, key DESC LIMIT ?
         )`
    ).run(workspaceId, profileId, workspaceId, profileId, COVER_NOTES_KEPT);
    return at;
  });
  return run.immediate();
}

/** How many cover notes the profile holds (the bound's test). */
export function countCoverNotes(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): number {
  const row = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'cover_note'`)
    .get(workspaceId, profileId) as { n: number };
  return row.n;
}
