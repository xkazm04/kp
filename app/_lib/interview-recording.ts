// Opt-in candidate audio recording for the AI interview (spark ai-interview-parity).
//
// WHAT THIS IS. With the workspace setting on, and with the candidate's SEPARATE tick
// (never the transcript consent), the browser records the CANDIDATE'S MICROPHONE ONLY
// and streams it here in chunks. The audio lives on OUR disk beside kp.sqlite —
// provider-neutral and self-host friendly — and exists for one purpose: a recruiter
// re-listening to repair a speech-recognition error on a technology name (registry:
// recruiting/voice-interview-fidelity). It is an OBSERVATION AID. Nothing scores it,
// nothing is derived from it, and no surface may present it as evidence of a verdict.
//
// WHERE IT LIVES. `<dirname(KP_DB_PATH)>/recordings/<workspaceId>/<sessionId>-a<n>.<ext>`.
// Both path segments and the file name are built from SERVER-minted ids only
// (interview-recording-paths.recordingFileName), so no caller-supplied string reaches
// a path. On the shipped image that is `/data/recordings`, i.e. the same persistent
// volume as the database (docs/architecture/self-hosting.md §4).
//
// WHEN IT GOES.
//   • 30 days after the hiring decision, or
//   • 180 days after the call itself when no decision was ever taken (the backstop), or
//   • the moment the candidate asks, from their own status page, or
//   • with a GDPR Art. 17 erasure of the candidate.
// The nightly `interview_recording_retention` job enforces the first two, and the
// recruiter's playback door re-checks the SAME predicate on every read so a stopped
// clock cannot keep serving audio past its window (registry:
// candidate-consent-and-retention / read-time-gate-not-just-the-sweep).
//
// The FILE is unlinked; the `RecordingMeta` row stays with its deletion stamped on it.
// The deletion is the record.

import { appendFile } from "node:fs/promises";
import { mkdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { DB_PATH } from "./db-path";
import { getDecisionConfig } from "./decision-config-store";
import type { ComplianceRule } from "./decision-config-schema";
import { isTerminalEntryStatus } from "./pipeline-status";
import { appendInterviewEvents } from "./db/interview-events";
import {
  listInterviewRecordingsDue,
  listInterviewRecordingsForEntry,
  markInterviewRecordingsDeleted,
  type RecordingRetentionRow,
} from "./db/interviews";
import type { RecordingDeleteReason, RecordingMeta } from "./voice/director-types";
import {
  isRecordingRetentionDue,
  isServerId,
  RECORDING_DIR_NAME,
  type RecordingMime,
} from "./interview-recording-paths";

/** Whether this workspace offers candidates an audio recording of their interview.
 *
 *  Default OFF, and ANY failure to read is OFF: an operator who has not turned this on
 *  — or a config row that will not parse — must never end up holding candidate audio.
 *  (The compliance phase is where it lives because this is a consent-and-retention
 *  decision about candidate data, made once per workspace beside the jurisdiction that
 *  frames it; see the package report for why not a voice-specific settings surface.) */
export function isInterviewRecordingOffered(workspaceId: string): boolean {
  try {
    return getDecisionConfig<ComplianceRule>("compliance", workspaceId).interviewRecordingOffered === true;
  } catch (error) {
    // Not offering is the safe reading, but it is NOT nothing: a workspace that turned
    // recording on is silently no longer offering it, and only this line says so.
    console.error(`[interview-recording] compliance config unreadable for workspace ${workspaceId} — recording is OFF`, error);
    return false;
  }
}

/** The root every workspace's recordings folder sits under — the directory that holds
 *  the SQLite file, so an operator's one backed-up volume covers both. */
export function recordingsRoot(): string {
  return path.join(path.dirname(DB_PATH), RECORDING_DIR_NAME);
}

/** Absolute path of one stored recording, or null when either id is not one the server
 *  minted (belt for the brace in `recordingFileName`). The `file` field is read back
 *  from a stored row, so it is re-validated here rather than trusted. */
export function recordingFilePath(workspaceId: string, file: string): string | null {
  if (!isServerId(workspaceId)) return null;
  if (!/^[A-Za-z0-9_-]{1,128}\.(webm|ogg|mp4)$/.test(file)) return null;
  return path.join(recordingsRoot(), workspaceId, file);
}

/** Append one claimed chunk to its file, creating the workspace folder on first use.
 *  Async on purpose and ALWAYS outside a transaction — better-sqlite3 transactions are
 *  synchronous and an await between BEGIN and COMMIT silently destroys atomicity. */
export async function appendRecordingChunk(workspaceId: string, file: string, bytes: Uint8Array): Promise<boolean> {
  const full = recordingFilePath(workspaceId, file);
  if (!full) return false;
  mkdirSync(path.dirname(full), { recursive: true });
  await appendFile(full, bytes);
  return true;
}

/** Size of a stored recording on disk, or null when the file is gone. The LEDGER's
 *  byte count is what the upload accounted for; this is what the playback door can
 *  actually serve, and a Range must be resolved against the second. */
export function recordingFileSize(workspaceId: string, file: string): number | null {
  const full = recordingFilePath(workspaceId, file);
  if (!full) return null;
  try {
    const s = statSync(full);
    return s.isFile() ? s.size : null;
  } catch {
    /* absent (already deleted, or never written) — the door answers 404 */
    return null;
  }
}

/** The hiring decision this recording's retention clock hangs off, or null when the
 *  candidate has not been decided.
 *
 *  WHICH TIMESTAMP, and why — this is the one the CODE actually records:
 *    • A terminal status (rejected / declined / rematched / role_closed) is written by
 *      `UPDATE pipeline_entries SET status=…, updated_at=?` and does NOT move
 *      `stage_changed_at` (db/pipeline.ts:3021, :3244, :863), so `updated_at` is the
 *      decision's own stamp.
 *    • A HIRE keeps `status='active'` and moves the stage to `Hired`, stamping
 *      `stage_changed_at` — which that code deliberately never moves again because it
 *      anchors time-to-hire (db/pipeline.ts:3047, :3072).
 *  CAVEAT, stated rather than hidden: `updated_at` also moves if someone edits a closed
 *  entry later, which can only DELAY a deletion. The 180-day backstop is the absolute
 *  ceiling that bounds it, and it is measured from the call, not from the entry. */
export function entryDecisionAt(row: {
  entryStatus: string | null;
  entryStage: string | null;
  entryStageChangedAt: string | null;
  entryUpdatedAt: string | null;
}): string | null {
  if (isTerminalEntryStatus(row.entryStatus)) return row.entryUpdatedAt ?? null;
  if (row.entryStage === "Hired") return row.entryStageChangedAt ?? row.entryUpdatedAt ?? null;
  return null;
}

/** Whether this session's audio is past its retention window right now. Shared by the
 *  nightly sweep and by the recruiter's playback door — one predicate, so a recording
 *  the clock has not reached yet is still refused on read. */
export function recordingRetentionDue(row: RecordingRetentionRow, nowMs: number = Date.now()): boolean {
  return isRecordingRetentionDue({ decidedAt: entryDecisionAt(row), callAt: row.callAt, nowMs });
}

/**
 * Delete the FILES of the named attempts and stamp the deletion on their rows.
 *
 * ORDER IS THE CONTRACT: unlink first, mark second. A crash between the two leaves a
 * row that still says "held" over a file that is gone — which the next sweep simply
 * re-runs — where the reverse order would leave a row claiming a deletion that never
 * happened. Synchronous throughout so the GDPR erasure path can call it straight after
 * its transaction commits without introducing an await into that code path.
 *
 * Never called INSIDE a transaction: unlinking a file is irreversible and a rollback
 * cannot put it back.
 */
export function deleteSessionRecordings(
  row: RecordingRetentionRow,
  reason: RecordingDeleteReason,
  select: (meta: RecordingMeta) => boolean = () => true,
  nowIso: string = new Date().toISOString()
): number {
  const targets = row.recordings.filter((m) => !m.deletedAt && select(m));
  if (targets.length === 0) return 0;
  for (const meta of targets) {
    const full = recordingFilePath(row.workspaceId, meta.file);
    if (!full) continue;
    try {
      unlinkSync(full);
    } catch (error) {
      // ENOENT is the ordinary case on a re-run — the file is already gone and the row
      // is about to say so. Anything else is an operator's problem (a permission or a
      // read-only volume), and audio we believe deleted but cannot remove is exactly
      // the failure that must not be silent.
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        console.error(`[interview-recording] could not delete ${full} (session ${row.sessionId})`, error);
      }
    }
  }
  const marked = markInterviewRecordingsDeleted(
    row.sessionId,
    row.workspaceId,
    targets.map((m) => m.attempt),
    reason,
    nowIso
  );
  if (marked.length === 0) return 0;
  try {
    appendInterviewEvents(
      marked.map((attempt) => ({
        sessionId: row.sessionId,
        attempt,
        kind: "recording_deleted" as const,
        payload: { reason },
        at: nowIso,
      })),
      row.workspaceId,
      nowIso
    );
  } catch (error) {
    // The event is the audit trail, not the deletion: the file is already gone and the
    // row already records it. Losing the line is worth a log, never a thrown erasure.
    console.error(`[interview-recording] recording_deleted event not written for session ${row.sessionId}`, error);
  }
  return marked.length;
}

/** Every recording of one CANDIDATE's interviews, deleted. The GDPR Art. 17 path calls
 *  this AFTER its transaction commits (db/pipeline.ts `anonymizeEntry`); the candidate's
 *  own status-page control calls it with `candidate_request`. Returns how many attempts
 *  were deleted. Best-effort per session so one unreadable row cannot strand the rest. */
export function deleteEntryRecordings(entryId: string, workspaceId: string, reason: RecordingDeleteReason): number {
  let deleted = 0;
  for (const row of listInterviewRecordingsForEntry(entryId, workspaceId)) {
    try {
      deleted += deleteSessionRecordings(row, reason);
    } catch (error) {
      console.error(`[interview-recording] deletion failed for session ${row.sessionId} (entry ${entryId})`, error);
    }
  }
  return deleted;
}

/** Whether this candidate still has audio we hold — the ONLY thing the public status
 *  projection learns about recordings (a boolean; never a file name, a size or a date). */
export function entryHasRecording(entryId: string, workspaceId: string): boolean {
  try {
    return listInterviewRecordingsForEntry(entryId, workspaceId).length > 0;
  } catch (error) {
    // A read failure must not make the candidate's own control appear: offering a
    // delete that cannot be honoured is worse than not offering it.
    console.error(`[interview-recording] recording lookup failed for entry ${entryId}`, error);
    return false;
  }
}

export type RecordingRetentionSummary = {
  /** Sessions examined. */
  scanned: number;
  /** Attempts whose file was deleted and whose row now records it. */
  deleted: number;
  /** Sessions the sweep could not process (logged individually). */
  failed: number;
};

/** The nightly `interview_recording_retention` job (scheduler-jobs.ts). Deployment-wide
 *  by design — storage limitation is not one tenant's duty — with every WRITE scoped to
 *  the workspace the row itself names. Idempotent: an already-deleted attempt is skipped
 *  by `deleteSessionRecordings`, so a double tick costs nothing. */
export function runInterviewRecordingRetention(nowMs: number = Date.now()): RecordingRetentionSummary {
  const summary: RecordingRetentionSummary = { scanned: 0, deleted: 0, failed: 0 };
  for (const row of listInterviewRecordingsDue()) {
    summary.scanned += 1;
    try {
      if (!recordingRetentionDue(row, nowMs)) continue;
      summary.deleted += deleteSessionRecordings(row, "retention", () => true, new Date(nowMs).toISOString());
    } catch (error) {
      summary.failed += 1;
      console.error(`[interview-recording] retention sweep failed for session ${row.sessionId}`, error);
    }
  }
  return summary;
}

/** Re-exported so a caller needs ONE import for the door's whole vocabulary. */
export type { RecordingMime };
