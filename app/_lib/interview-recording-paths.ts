// The PURE half of opt-in candidate audio recording (spark ai-interview-parity):
// the media vocabulary, the byte budgets, the retention arithmetic, the file-name
// construction and the HTTP Range parse.
//
// Deliberately import-free (no DB, no fs, no next/*): every rule the recording
// feature turns on is a decision that must be readable and testable on its own —
// `interview-recording.ts` is the side-effecting half that applies them, and the
// upload/playback/deletion doors all resolve their answer through this module so a
// route, the retention sweep and the candidate's own delete door can never disagree
// about what "due", "too large" or "a legal file name" means.
//
// Registry (recruiting/candidate-consent-and-retention):
//   • `retention-ttl-and-derived-disclosure` — the two windows are CONSTANTS here and
//     the candidate-facing copy interpolates them, so the number enforced and the
//     number promised cannot drift.
//   • `read-time-gate-not-just-the-sweep` — `isRecordingRetentionDue` is what the
//     nightly job selects on AND what the recruiter's playback door re-checks, so a
//     stopped clock cannot keep serving audio past its window.

/** The container formats a browser's MediaRecorder actually produces, mapped to the
 *  extension the stored file carries. Anything else is refused at the door: the file
 *  name is built from THIS table, never from caller text. */
export const RECORDING_MIME_EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
} as const;

export type RecordingMime = keyof typeof RECORDING_MIME_EXTENSIONS;

/** Content-type header → the stored mime, or null when it is not one we accept.
 *  Parameters are stripped (`audio/webm;codecs=opus` is the type Chrome sends) and
 *  the comparison is case-insensitive, per RFC 9110 §8.3. */
export function normalizeRecordingMime(header: string | null | undefined): RecordingMime | null {
  if (!header) return null;
  const base = header.split(";")[0]!.trim().toLowerCase();
  return base in RECORDING_MIME_EXTENSIONS ? (base as RecordingMime) : null;
}

/** Hard cap on ONE uploaded chunk, enforced on the BYTES READ (request-body.ts), never
 *  on the caller's content-length. A 10 s Opus chunk is tens of kilobytes; 2 MB is two
 *  orders of magnitude of headroom and still bounds an anonymous token-holder's heap. */
export const MAX_RECORDING_CHUNK_BYTES = 2 * 1024 * 1024;

/** Hard cap on ONE session's audio across every attempt. ~80 MB is far past a booked
 *  interview at Opus bitrates; reaching it means something is wrong, so the recording
 *  is marked `partial` and the call goes on untouched. */
export const MAX_RECORDING_SESSION_BYTES = 80 * 1024 * 1024;

/** How long after the hiring decision the audio is kept. The candidate is told this
 *  number (see `interview.voice.recording.*`), so the two are one constant. */
export const RECORDING_RETENTION_AFTER_DECISION_DAYS = 30;

/** The BACKSTOP: an entry that never reaches a decision must not keep audio forever.
 *  Measured from the call itself, so it is an absolute ceiling on every recording. */
export const RECORDING_BACKSTOP_DAYS = 180;

/** How long after a call ends the upload door still accepts a chunk. MediaRecorder's
 *  final `dataavailable` fires after the transport is torn down, so the last chunk
 *  legitimately lands after POST /api/interview/complete has already finalized the row. */
export const RECORDING_LATE_FLUSH_MS = 2 * 60_000;

/** The directory (under the data dir that holds kp.sqlite) that recordings live in. */
export const RECORDING_DIR_NAME = "recordings";

const DAY_MS = 86_400_000;

/** A server-minted identifier: the session id (`iv…`) and the workspace id. Nothing a
 *  caller can supply reaches a path segment, and this is the belt for that brace — no
 *  dot, no slash, no backslash, so `..` and absolute paths are unrepresentable. */
export function isServerId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** `<sessionId>-a<attempt>.<ext>`, or null when any input is not something the SERVER
 *  produced. Returning null (rather than a sanitized guess) is deliberate: a caller
 *  holding an id we did not mint should be refused, not quietly filed somewhere else. */
export function recordingFileName(sessionId: string, attempt: number, mime: RecordingMime): string | null {
  if (!isServerId(sessionId)) return null;
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 999) return null;
  const ext = RECORDING_MIME_EXTENSIONS[mime];
  if (!ext) return null;
  return `${sessionId}-a${attempt}.${ext}`;
}

/** An attempt number off the wire. Same rule as the file name's, stated once. */
export function parseRecordingAttempt(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** A chunk index off the wire: 0-based, monotonically increasing per attempt. */
export function parseRecordingChunk(raw: string | null | undefined): number | null {
  if (!raw || !/^\d{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Whether a session in this state may still take audio.
 *
 *  `in_progress` is the live call. `completed`/`failed` take chunks for
 *  RECORDING_LATE_FLUSH_MS after they ended, because the final flush races /complete
 *  by construction. Everything else — `created` (never connected) and `revoked` (the
 *  recruiter pulled the link) — is refused: audio for a call that is not happening,
 *  or for a credential that was withdrawn, is exactly what must not be stored. */
export function recordingAcceptsChunk(input: {
  status: string;
  endedAt: string | null;
  nowMs: number;
  lateFlushMs?: number;
}): boolean {
  if (input.status === "in_progress") return true;
  if (input.status !== "completed" && input.status !== "failed") return false;
  const endedMs = input.endedAt ? Date.parse(input.endedAt) : Number.NaN;
  if (!Number.isFinite(endedMs)) return false;
  return input.nowMs - endedMs <= (input.lateFlushMs ?? RECORDING_LATE_FLUSH_MS);
}

/** When this attempt's audio must be gone, as an epoch ms — the EARLIER of
 *  "decision + 30 days" and "the call + 180 days".
 *
 *  `decidedAt` is the hiring decision the code actually records (see
 *  `entryDecisionAt` in interview-recording.ts); null means the entry never reached
 *  one, and then only the backstop applies. `callAt` is the recording's own start,
 *  falling back to the session row's creation when a legacy row carries none — never
 *  to "now", which would make every unreadable timestamp mean "keep forever". */
export function recordingDeleteDueAtMs(input: { decidedAt: string | null; callAt: string | null }): number | null {
  const callMs = input.callAt ? Date.parse(input.callAt) : Number.NaN;
  const decidedMs = input.decidedAt ? Date.parse(input.decidedAt) : Number.NaN;
  const backstop = Number.isFinite(callMs) ? callMs + RECORDING_BACKSTOP_DAYS * DAY_MS : null;
  const afterDecision = Number.isFinite(decidedMs) ? decidedMs + RECORDING_RETENTION_AFTER_DECISION_DAYS * DAY_MS : null;
  if (backstop === null) return afterDecision;
  if (afterDecision === null) return backstop;
  return Math.min(backstop, afterDecision);
}

/** Read-time gate AND sweep predicate: is this attempt's audio past its window?
 *
 *  A recording whose dates cannot be read at all answers TRUE. That is the
 *  candidate-favouring direction (registry: uncertainty-resolves-toward-the-candidate):
 *  audio we cannot date is audio we cannot justify keeping, and the cost of dropping it
 *  is a recruiter losing a replay, while the cost of the reverse is unbounded retention. */
export function isRecordingRetentionDue(input: { decidedAt: string | null; callAt: string | null; nowMs: number }): boolean {
  const dueAt = recordingDeleteDueAtMs(input);
  if (dueAt === null) return true; // undatable — see above
  return input.nowMs >= dueAt;
}

/** One HTTP byte range over a file of `size` bytes, so an `<audio>` element can seek.
 *
 *  Returns `null` for no Range header at all (serve the whole file), `"unsatisfiable"`
 *  for a syntactically valid range that falls outside the file (416), and the resolved
 *  inclusive `[start, end]` otherwise. A malformed header is treated as ABSENT, which
 *  is what RFC 9110 §14.2 requires. Only the single-range form is honoured; a
 *  multi-range request is served whole rather than answered with a multipart body. */
export function parseByteRange(header: string | null | undefined, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // A suffix range: the LAST n bytes.
    const n = Number(rawEnd);
    if (!Number.isInteger(n) || n <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isInteger(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isInteger(end) || end < start) return "unsatisfiable";
  return { start, end };
}
