import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { interviewRecordingRowForSession } from "@/app/_lib/db/interviews";
import { recordingFilePath, recordingFileSize, recordingRetentionDue } from "@/app/_lib/interview-recording";
import { parseByteRange, parseRecordingAttempt } from "@/app/_lib/interview-recording-paths";

// GET /api/interview/recording/[sessionId]?attempt=N — the recruiter's playback door.
//
// Operator-gated and workspace-scoped exactly like its recruiter siblings
// (/api/interview/sessions/[id], /api/interview/by-entry): a foreign or unknown id
// answers the SAME 404, so the door can never be used to learn which candidates were
// recorded. This is the ONLY way audio leaves the server — the files sit outside the
// public tree, so there is no static path that bypasses this gate.
//
// It serves HTTP Range, because an <audio> element seeks: that is the entire point of
// a recording a recruiter opens to re-hear one technology name.
//
// READ-TIME RETENTION GATE. The nightly sweep is an optimisation, not the control: a
// deployment whose clock never started (a fresh self-host, a worker nobody registered)
// would otherwise keep serving audio for years. The same predicate the sweep selects on
// is re-evaluated here, so a recording past its window is gone from the wire whether or
// not anything has deleted it yet (registry: candidate-consent-and-retention /
// read-time-gate-not-just-the-sweep).
export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { sessionId } = await context.params;
    const ws = await currentWorkspace();
    const row = interviewRecordingRowForSession(sessionId, ws);
    if (!row) return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);
    if (recordingRetentionDue(row)) return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);

    // No `attempt` means the latest one that still has audio — the recruiter asking for
    // "the recording" means the call that was actually completed, not attempt 1 of a
    // link that dropped and was retried.
    const wanted = parseRecordingAttempt(request.nextUrl.searchParams.get("attempt"));
    const live = row.recordings.filter((m) => !m.deletedAt);
    const meta = wanted === null ? live[live.length - 1] : live.find((m) => m.attempt === wanted);
    if (!meta) return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);

    const full = recordingFilePath(row.workspaceId, meta.file);
    const size = full ? recordingFileSize(row.workspaceId, meta.file) : null;
    // The ROW says we hold audio and the disk says otherwise — an operator deleted the
    // volume's contents, or a write failed. The caller gets the same 404 as every other
    // "not available" reading; the log is where the difference lives.
    if (!full || size === null || size === 0) {
      console.warn(`[interview:recording] ledger claims audio for session ${row.sessionId} attempt ${meta.attempt}, file is absent`);
      return jsonRefusal("INTERVIEW_RECORDING_NOT_FOUND", 404);
    }

    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}`, "accept-ranges": "bytes" } });
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const headers: Record<string, string> = {
      "content-type": meta.mime,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      // Candidate audio: never cached by an intermediary, and never persisted by the
      // browser past the tab that is playing it.
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${meta.attempt}.${meta.mime.split("/")[1]}"`,
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    // STREAMED, not buffered: a session may hold up to 80 MB and a recruiter's seek
    // must not pull the whole file through this process's heap. `Readable.toWeb` hands
    // back Node's own web stream, which is structurally the BodyInit a Response wants
    // but is typed in node:stream/web rather than lib.dom — hence the single cast.
    const body = Readable.toWeb(createReadStream(full, { start, end })) as unknown as ReadableStream<Uint8Array>;
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return safeJsonError(error, "api:interview:recording/[sessionId]", "INTERVIEW_RECORDING_FAILED");
  }
}
