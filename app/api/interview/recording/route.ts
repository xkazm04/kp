import { NextRequest, NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { rateLimit } from "@/app/_lib/rate-limit";
import { readBytesWithLimit } from "@/app/_lib/request-body";
import { appendInterviewEvents } from "@/app/_lib/db/interview-events";
import {
  claimInterviewRecordingChunk,
  getInterviewSessionByToken,
  markInterviewRecordingPartial,
} from "@/app/_lib/db/interviews";
import { appendRecordingChunk, isInterviewRecordingOffered } from "@/app/_lib/interview-recording";
import {
  MAX_RECORDING_SESSION_BYTES,
  normalizeRecordingMime,
  parseRecordingAttempt,
  parseRecordingChunk,
  recordingAcceptsChunk,
  recordingFileName,
} from "@/app/_lib/interview-recording-paths";

// PUBLIC TOKEN ROUTE — the candidate's own microphone audio, one chunk at a time
// (spark ai-interview-parity, WP3).
//
// THE TOKEN IS NEVER IN THE URL. It rides in `x-kp-token` beside the session id, the
// attempt and the chunk index, for the reason every candidate capability link in this
// app is careful about: a URL lands in access logs, in a Referer header and in browser
// history, and this one is the credential to a live interview. The body is the raw
// audio, so there is no JSON envelope to carry it in.
//
//   POST /api/interview/recording
//     headers: x-kp-token, x-kp-session, x-kp-attempt, x-kp-chunk,
//              content-type: audio/webm | audio/ogg | audio/mp4
//     body:    the raw chunk
//     → { ok: true, duplicate?: true }
//
// NOTHING HERE MAY DISTURB THE CALL. Every refusal is a code the browser logs and
// stops recording on; the interview itself is untouched, which is the whole posture of
// an observation aid (registry: recruiting/voice-interview-fidelity).

/** Hard cap on ONE chunk of audio, enforced on the BYTES READ rather than on the
 *  caller's content-length (request-body.ts) — the header is advisory and a caller may
 *  omit or lie about it. 10 s of Opus is tens of KB; this is two orders of magnitude of
 *  headroom and still bounds an anonymous token-holder's heap. */
const MAX_RECORDING_BODY_BYTES = 2 * 1024 * 1024;

// Per-TOKEN, like /connect and /director: the interview link IS the credential and one
// candidate's call is exactly one token, so an IP component would only punish a NAT.
// 240/10min = one chunk every 2.5 s sustained, well above the 10 s timeslice the hook
// uploads on (plus its sequential retries), and far below what a script would want.
const RECORDING_RATE_LIMIT = { limit: 240, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("x-kp-token");
    const sessionId = request.headers.get("x-kp-session");
    const attempt = parseRecordingAttempt(request.headers.get("x-kp-attempt"));
    const chunk = parseRecordingChunk(request.headers.get("x-kp-chunk"));
    // A malformed envelope is the same fact as a bad link to the reader: this upload
    // does not identify an interview we can store audio for. No honest client can send
    // it, and inventing a second code for it would only tell a prober more.
    if (!token || token.length > 200 || !sessionId || attempt === null || chunk === null) {
      return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 400);
    }
    // The container format decides the stored file's EXTENSION, so the allow-list is
    // also the path-safety boundary. Refused before anything is read off the wire.
    const mime = normalizeRecordingMime(request.headers.get("content-type"));
    if (!mime) return jsonRefusal("INTERVIEW_RECORDING_TYPE_UNSUPPORTED", 415);

    const session = getInterviewSessionByToken(token);
    if (!session || session.id !== sessionId) return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 404);

    // CONSENT IS A FACT IN THE ROW, not a claim in the request. /connect stamps
    // recording_consent_at only when the workspace offers recording AND the candidate
    // ticked the separate box; the offer is re-read HERE because an operator may have
    // switched it off since the call started, and audio must stop being kept the moment
    // they do.
    if (!session.recordingConsentAt || !isInterviewRecordingOffered(session.workspaceId)) {
      return jsonRefusal("INTERVIEW_RECORDING_NOT_OFFERED", 403);
    }
    // `in_progress`, or a call that ended less than two minutes ago — MediaRecorder's
    // final `dataavailable` fires after teardown, so the last chunk legitimately lands
    // after /complete has already finalized the row. A revoked or never-connected link
    // is refused: audio for a call that is not happening must not be stored.
    if (!recordingAcceptsChunk({ status: session.status, endedAt: session.endedAt, nowMs: Date.now() })) {
      return jsonRefusal("INTERVIEW_RECORDING_CLOSED", 409);
    }

    // AFTER the cheap refusals above (none of them reads a byte of the body or touches
    // the disk) and BEFORE the body read, which is the expensive work: up to 2 MB into
    // this process's heap, then a filesystem append.
    if (!rateLimit(`interview-recording:${token}`, RECORDING_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }

    const bytes = await readBytesWithLimit(request, MAX_RECORDING_BODY_BYTES);
    if (bytes === null) return jsonRefusal("PAYLOAD_TOO_LARGE", 413, { maxBytes: MAX_RECORDING_BODY_BYTES });
    if (bytes.byteLength === 0) return NextResponse.json({ ok: true, empty: true });

    // Built from SERVER ids only — the session id off the row we just read and the
    // extension off the mime allow-list. Nothing a caller typed reaches a path segment,
    // so `..` and absolute paths are unrepresentable rather than filtered.
    const file = recordingFileName(session.id, attempt, mime);
    if (!file) return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 400);

    // Claim the chunk FIRST (the cursor, the byte accounting and the per-session
    // ceiling, under one IMMEDIATE transaction), then write the bytes. A replay at or
    // below the stored cursor is already on disk and is acknowledged, never appended.
    const claim = claimInterviewRecordingChunk({
      sessionId: session.id,
      workspaceId: session.workspaceId,
      attempt,
      chunk,
      bytes: bytes.byteLength,
      mime,
      file,
      maxSessionBytes: MAX_RECORDING_SESSION_BYTES,
    });
    if (claim.outcome === "missing") return jsonRefusal("INTERVIEW_LINK_NOT_FOUND", 404);
    if (claim.outcome === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
    if (claim.outcome === "full") {
      return jsonRefusal("INTERVIEW_RECORDING_FULL", 413, { maxBytes: MAX_RECORDING_SESSION_BYTES });
    }

    try {
      await appendRecordingChunk(session.workspaceId, file, bytes);
    } catch (writeErr) {
      // The claim already counted these bytes, so the file is now shorter than its
      // ledger says: say so on the row rather than leaving a recording that silently
      // misses a passage. The call is not disturbed either way.
      markInterviewRecordingPartial(session.id, session.workspaceId, attempt);
      return safeJsonError(writeErr, "api:interview:recording", "INTERVIEW_RECORDING_FAILED");
    }

    // The first chunk of an attempt is when audio started existing for this call — the
    // one fact the append-only event record must carry, so a recruiter's evidence view
    // and an audit both see it without reading the ledger blob. Best-effort: the audio
    // is already on disk and a lost line must not fail the upload.
    if (claim.first) {
      try {
        appendInterviewEvents(
          [{ sessionId: session.id, attempt, kind: "recording_started", payload: { mime } }],
          session.workspaceId
        );
      } catch (eventErr) {
        console.error(`[interview:recording] recording_started event not written for session ${session.id}`, eventErr);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return safeJsonError(error, "api:interview:recording", "INTERVIEW_RECORDING_FAILED");
  }
}
