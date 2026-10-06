// The per-entry note THREAD — authored, append-only notes on a pipeline entry, beside the
// `pipeline_entries.notes` scratchpad (which this does not touch or replace).
//
// APPEND-ONLY. There is no UPDATE and no door-level DELETE here: a note is a record that a
// person said something about a candidate at a time. The one DELETE is the erasure scrub
// inside anonymizeEntry (db/pipeline.ts), which removes the whole thread with the entry.
//
// AUTHORSHIP comes from the SESSION and nowhere else: the caller passes the session's user
// id (null in no-auth mode, stored NULL). The request body is never an input to it. The
// display name is resolved at READ time from `users`, so a rename shows the current name
// and the row holds no copy of it.
//
// Tenancy: `pipeline_entry_notes` is workspace-scoped. The insert DERIVES workspace_id from
// the entry (the way recordEvent does for pipeline_events), so a caller cannot file a note
// on another team's entry; every read binds workspace_id too.

import { randomUUID } from "node:crypto";
import { ensureDb } from "./core";

/** Upper bound for a recruiter note — the scratchpad's set_notes and every thread note
 *  share it. Generous enough for pasted call notes, tight enough that the column can't
 *  become a blob dump. The drawer's textarea enforces the same cap client-side. */
export const MAX_NOTES_LENGTH = 4000;

/** How many notes one read returns; a thread is a conversation, not an archive. */
const LIST_LIMIT = 500;

export type EntryNote = {
  id: string;
  entryId: string;
  /** The session user who wrote it; null = written with no signed-in user (local mode). */
  authorUserId: string | null;
  /** The author's CURRENT name (or email when unnamed); null when there is no author or
   *  the account no longer exists. */
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type AppendNoteResult =
  | { ok: true; note: EntryNote }
  | { ok: false; status: 400 | 404; code: string; data?: { max: number; length: number } };

type NoteRow = {
  id: string;
  entry_id: string;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

function fromRow(r: NoteRow): EntryNote {
  return {
    id: r.id,
    entryId: r.entry_id,
    authorUserId: r.author_user_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: r.created_at,
  };
}

/** One entry's thread, oldest first (newest last). Empty for an entry in another
 *  workspace — the read binds the tenant, so a foreign id answers nothing. */
export function listEntryNotes(entryId: string, workspaceId: string): EntryNote[] {
  const rows = ensureDb()
    .prepare(
      `SELECT n.id, n.entry_id, n.author_user_id, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS author_name, n.body, n.created_at
         FROM pipeline_entry_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.entry_id = ? AND n.workspace_id = ?
        ORDER BY n.created_at ASC, n.rowid ASC LIMIT ?`
    )
    .all(entryId, workspaceId, LIST_LIMIT) as NoteRow[];
  return rows.map(fromRow);
}

/**
 * Validate and append one note. `note` is the untrusted request value; `sessionUserId` is
 * the SESSION's user id (null when there is none) — the only identity this accepts.
 *
 * The entry is looked up IN the caller's workspace and the row's workspace_id is taken
 * from it, so an unknown, foreign or already-erased entry is a 404 and writes nothing.
 * One statement (INSERT … SELECT), so the existence check and the write cannot straddle
 * an erasure. Refusals are codes; the cap rides as data, exactly as set_notes does.
 */
export function appendEntryNoteFromBody(
  entryId: string,
  workspaceId: string,
  note: unknown,
  sessionUserId: string | null
): AppendNoteResult {
  if (typeof note !== "string") return { ok: false, status: 400, code: "PIPELINE_NOTES_INVALID" };
  const body = note.trim();
  if (body === "") return { ok: false, status: 400, code: "PIPELINE_NOTE_EMPTY" };
  if (body.length > MAX_NOTES_LENGTH) {
    return { ok: false, status: 400, code: "PIPELINE_NOTES_TOO_LONG", data: { max: MAX_NOTES_LENGTH, length: body.length } };
  }
  const id = `note-${randomUUID()}`;
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `INSERT INTO pipeline_entry_notes (id, entry_id, workspace_id, author_user_id, body, created_at)
       SELECT ?, e.id, e.workspace_id, ?, ?, ? FROM pipeline_entries e
        WHERE e.id = ? AND e.workspace_id = ? AND e.anonymized_at IS NULL`
    )
    .run(id, sessionUserId, body, now, entryId, workspaceId);
  if (res.changes === 0) return { ok: false, status: 404, code: "PIPELINE_ENTRY_NOT_FOUND" };
  const row = ensureDb()
    .prepare(
      `SELECT n.id, n.entry_id, n.author_user_id, COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS author_name, n.body, n.created_at
         FROM pipeline_entry_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.id = ? AND n.workspace_id = ?`
    )
    .get(id, workspaceId) as NoteRow | undefined;
  if (!row) return { ok: false, status: 404, code: "PIPELINE_ENTRY_NOT_FOUND" };
  return { ok: true, note: fromRow(row) };
}
