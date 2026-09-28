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

// role_research: what the seeker's target titles ask for, researched on the web (one row
// per title set + markets, ROLE_RESEARCH_KEPT kept). github: the seeker's own GitHub read
// and what they chose to use of it (one row, key ''). Both are the seeker's own state:
// erased with the profile (eraseJobseekerData deletes every kind).
export const UI_STATE_KINDS = ["cv_design", "cover_note", "role_research", "github"] as const;
/** How many research rows a profile keeps: a seeker trying titles keeps the last few. */
export const ROLE_RESEARCH_KEPT = 6;
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

/** The research stored under `key` (the route derives it from the titles and markets), or null. */
export function getRoleResearch(profileId: string, key: string, workspaceId: string = DEFAULT_WORKSPACE_ID): UiStateEntry<Record<string, unknown>> | null {
  const row = ensureDb()
    .prepare(`SELECT key, value_json, updated_at FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'role_research' AND key = ?`)
    .get(workspaceId, profileId, key) as Row | undefined;
  return entryOf<Record<string, unknown>>(row, "jobseekerUiState.roleResearch");
}

/** Keep one research result; past ROLE_RESEARCH_KEPT the least recently written go, in
 *  the same IMMEDIATE transaction (the cover-note bound's shape). */
export function setRoleResearch(profileId: string, key: string, value: Record<string, unknown>, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  const d = ensureDb();
  const run = d.transaction((): string => {
    const at = put(profileId, "role_research", key, value, workspaceId);
    d.prepare(
      `DELETE FROM jobseeker_ui_state
       WHERE workspace_id = ? AND profile_id = ? AND kind = 'role_research'
         AND key NOT IN (
           SELECT key FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'role_research'
           ORDER BY updated_at DESC, key DESC LIMIT ?
         )`
    ).run(workspaceId, profileId, workspaceId, profileId, ROLE_RESEARCH_KEPT);
    return at;
  });
  return run.immediate();
}

/** The seeker's GitHub read and their choices about it, or null (never read). */
export function getGithubState(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): UiStateEntry<Record<string, unknown>> | null {
  const row = ensureDb()
    .prepare(`SELECT key, value_json, updated_at FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'github' AND key = ''`)
    .get(workspaceId, profileId) as Row | undefined;
  return entryOf<Record<string, unknown>>(row, "jobseekerUiState.github");
}

export function setGithubState(profileId: string, value: Record<string, unknown>, workspaceId: string = DEFAULT_WORKSPACE_ID): string {
  return put(profileId, "github", "", value, workspaceId);
}

/** Forget the GitHub read (the seeker disconnects it). True when there was one. */
export function deleteGithubState(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`DELETE FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'github' AND key = ''`)
    .run(workspaceId, profileId);
  return res.changes > 0;
}
