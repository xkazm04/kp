import { isDialogKind, type DialogArtifact, type DialogKind, type JobseekerDialog, type StudioTurn } from "../jobseeker/types";
import { randomId } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// The seeker's Studio dialogs (app/_lib/jobseeker/types.ts): a cv_polish conversation
// over the uploaded CV, or a fit conversation about one posting. The transcript is the
// server truth; the artifact is what the dialog has produced so far.
//
// Tenancy: every statement binds `workspace_id = ?`, point reads included
// (jobseeker-dialogs-tenancy.test.ts). No carve-out.
//
// The write is a COMPARE-AND-SWAP on updated_at (intakes.ts's casUpdate shape): a
// reply is computed during an LLM call that can take many seconds, and the transcript
// is replaced whole, so a turn that landed meanwhile would be silently reverted by
// whatever the call eventually returned. The caller re-asserts the version it read and
// gets `moved` instead — its job is then to recompute, not to clobber.

export type DialogCasResult = "ok" | "moved" | "missing";

type DialogRow = {
  id: string;
  workspace_id: string;
  profile_id: string;
  kind: string;
  posting_id: string | null;
  transcript_json: string;
  artifact_json: string | null;
  status: string;
  lang: string;
  created_at: string;
  updated_at: string;
};

/** Bound at the write so a long conversation cannot grow the row without limit; the
 *  opening turns are the ones a later reader needs least, so the head is dropped. */
const MAX_STORED_TURNS = 400;

function capTurns(turns: StudioTurn[]): StudioTurn[] {
  return turns.length > MAX_STORED_TURNS ? turns.slice(turns.length - MAX_STORED_TURNS) : turns;
}

function fromRow(row: DialogRow): JobseekerDialog {
  const transcript = safeRowParse<StudioTurn[]>(row.transcript_json, "jobseekerDialog.transcript", row.id);
  const artifact = safeRowParse<DialogArtifact>(row.artifact_json, "jobseekerDialog.artifact", row.id);
  return {
    id: row.id,
    profileId: row.profile_id,
    // CHECK-constrained at the DDL; the guard only protects a hand-edited DB.
    kind: isDialogKind(row.kind) ? row.kind : "cv_polish",
    postingId: row.posting_id,
    transcript: Array.isArray(transcript) ? transcript : [],
    artifact: artifact && typeof artifact === "object" ? artifact : null,
    status: row.status === "closed" ? "closed" : "open",
    lang: row.lang,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createDialog(
  input: { profileId: string; kind: DialogKind; postingId: string | null; lang: string; opening: StudioTurn[] },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): JobseekerDialog {
  const d = ensureDb();
  const id = randomId("jsd");
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO jobseeker_dialogs
       (id, workspace_id, profile_id, kind, posting_id, transcript_json, artifact_json, status, lang, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 'open', ?, ?, ?)`
  ).run(id, workspaceId, input.profileId, input.kind, input.postingId, JSON.stringify(capTurns(input.opening)), input.lang.slice(0, 16), now, now);
  return fromRow(d.prepare(`SELECT * FROM jobseeker_dialogs WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as DialogRow);
}

export function getDialog(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerDialog | null {
  const row = ensureDb()
    .prepare(`SELECT * FROM jobseeker_dialogs WHERE id = ? AND workspace_id = ?`)
    .get(id, workspaceId) as DialogRow | undefined;
  return row ? fromRow(row) : null;
}

/** A profile's dialogs, most recently touched first. */
export function listDialogs(profileId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerDialog[] {
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM jobseeker_dialogs WHERE profile_id = ? AND workspace_id = ?
       ORDER BY updated_at DESC, id DESC LIMIT 200`
    )
    .all(profileId, workspaceId) as DialogRow[];
  return rows.map(fromRow);
}

/** The verdict the seeker SETTLED ON for one posting: the most recently touched CLOSED
 *  fit dialog. Closed only — an open conversation has no settled verdict, and the
 *  overlay is where an in-flight one belongs; the posting page reads this one so the
 *  fit artifact does not live exclusively inside a modal nobody reopened. */
export function latestFitDialogForPosting(postingId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): JobseekerDialog | null {
  const row = ensureDb()
    .prepare(
      `SELECT * FROM jobseeker_dialogs
       WHERE posting_id = ? AND workspace_id = ? AND kind = 'fit' AND status = 'closed'
       ORDER BY updated_at DESC, id DESC LIMIT 1`
    )
    .get(postingId, workspaceId) as DialogRow | undefined;
  return row ? fromRow(row) : null;
}

/** One exchange landed: append `turns`, replace the artifact (null = leave as stored),
 *  and close when `done`. The transcript is re-read INSIDE the write transaction and
 *  appended to, and the version the caller computed against is re-asserted — so a
 *  concurrent turn is never spliced away, and a stale reply answers `moved`. A closed
 *  dialog answers `missing`: nothing may be appended to a conversation that ended. */
export function appendDialogTurns(
  id: string,
  expectedUpdatedAt: string,
  turns: StudioTurn[],
  artifact: DialogArtifact | null,
  done: boolean,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): DialogCasResult {
  const d = ensureDb();
  const run = d.transaction((): DialogCasResult => {
    const row = d
      .prepare(`SELECT * FROM jobseeker_dialogs WHERE id = ? AND workspace_id = ? AND status = 'open'`)
      .get(id, workspaceId) as DialogRow | undefined;
    if (!row) return "missing";
    // Millisecond-resolution ISO strings: two writes inside the same millisecond are
    // indistinguishable, but the window guarded here is an LLM call, not a millisecond.
    if (row.updated_at !== expectedUpdatedAt) return "moved";
    const transcript = capTurns([...fromRow(row).transcript, ...turns]);
    const res = d
      .prepare(
        `UPDATE jobseeker_dialogs
         SET transcript_json = ?, artifact_json = COALESCE(?, artifact_json), status = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND updated_at = ?`
      )
      .run(
        JSON.stringify(transcript),
        artifact ? JSON.stringify(artifact) : null,
        done ? "closed" : "open",
        new Date().toISOString(),
        id,
        workspaceId,
        expectedUpdatedAt
      );
    return res.changes > 0 ? "ok" : "moved";
  });
  return run.immediate();
}

export function closeDialog(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): boolean {
  const res = ensureDb()
    .prepare(`UPDATE jobseeker_dialogs SET status = 'closed', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'open'`)
    .run(new Date().toISOString(), id, workspaceId);
  return res.changes > 0;
}
