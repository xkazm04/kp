// Single source of truth for CV/JD file-upload constraints, shared between the
// client drop zones (which gate by extension) and the server routes (which gate
// by MIME, falling back to the extension when the browser reports no type). Keep
// the two channels paired here so they can't drift — see validateUploadServer
// for the empty-MIME fallback that keeps the server enforcing the same contract.

export const ACCEPT_EXTENSIONS = ".pdf,.docx,.txt,.md";

export const ACCEPT_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  // Some browsers report an empty type for .md / extensionless files, so an
  // empty type is accepted — but ONLY when the filename still matches
  // EXTENSION_RE. validateUploadServer layers that extension fallback on top, so
  // a blank Content-Type alone can't wave any file past the server gate.
  "",
]);

// ── The one end-to-end max input file-size contract (idea-36cc4b87) ──────────
// MAX_FILE_BYTES is THE per-file ceiling for every user-supplied document — a
// CV/profile, a job description, or a company overview. It is enforced
// identically on both sides of the wire so a too-big file is rejected the same
// way wherever it enters:
//   • client — acceptUpload() (below) rejects at the drop/select moment, before
//     the bytes ever upload.
//   • server — the /api/analyze and /api/extract-text Route Handlers re-check
//     every File and reject an over-limit one with FILE_TOO_LARGE_STATUS (413)
//     *before* any work starts. The user therefore never depends on whichever
//     downstream buffer happens to overflow first to learn the file was too big.
//
// How this relates to the other two size limits in the stack:
//   • next.config.ts serverActions.bodySizeLimit ("10mb") bounds Server Action
//     request bodies only. The upload routes are Route Handlers, NOT Server
//     Actions, so that limit does not gate them — this per-file ceiling is
//     their real boundary. 10mb is deliberately held above MAX_FILE_MB so any
//     future Server-Action upload path still clears one max-size document plus
//     multipart framing overhead.
//   • python-runner.ts PYTHON_MAX_BUFFER_MB (64 MB) caps the child process's
//     *output* (stdout+stderr) buffered in the heap. That is unrelated to input
//     file size and is intentionally far larger, so a legitimate result is
//     never truncated. See its comment for the reverse cross-reference.
//
// To change the contract, change MAX_FILE_BYTES / MAX_FILE_MB / MAX_FILE_HINT
// here — the client gate, both routes, and the hint text all read from this one
// place. If you raise MAX_FILE_MB toward ~9, raise next.config.ts's 10mb too.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_MB = 8;
export const MAX_FILE_HINT = "PDF · DOCX · TXT · MD up to 8 MB";
export const MAX_CV_VARIANTS = 3;

/**
 * HTTP status a route returns when an upload exceeds MAX_FILE_BYTES — 413
 * ("Content Too Large", RFC 9110 §15.5.14). Kept distinct from the 400 used for
 * a wrong file *type* so the client and the logs can tell "too big" from "wrong
 * kind" without string-matching the message.
 */
export const FILE_TOO_LARGE_STATUS = 413;

/**
 * The canonical over-limit message for the server boundary, e.g.
 * "The profile exceeds the 8 MB upload limit." `label` names the offending
 * input ("profile", "job description", "CV variant 2", …) so the user knows
 * which file to shrink. Pairs with FILE_TOO_LARGE_STATUS.
 */
export function fileTooLargeMessage(label: string): string {
  return `The ${label} exceeds the ${MAX_FILE_MB} MB upload limit.`;
}

const EXTENSION_RE = /\.(pdf|docx|txt|md)$/i;

/** Result of the upload gate: the accepted File, or the reason it was rejected. */
export type UploadAcceptance =
  | { ok: true; file: File }
  | { ok: false; error: string };

/**
 * The single client-side gate every CV / job-description / company File must
 * pass through before it enters component state. Checks extension + size so a
 * bad file — a 20 MB PNG dropped anywhere on the page, or used to Replace an
 * existing upload — is rejected instantly with an inline message, instead of
 * only failing after the upload round-trips to the server. Every intake path
 * (empty drop zone, Replace, Add-variant, drop-anywhere overlay) routes through
 * here via the `useFileAccept` hook; see app/features/tools/analyze/useFileAccept.ts.
 */
export function acceptUpload(file: File): UploadAcceptance {
  if (!EXTENSION_RE.test(file.name)) {
    return { ok: false, error: "Use a PDF, DOCX, TXT, or MD file." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `File exceeds the ${MAX_FILE_MB} MB limit.` };
  }
  return { ok: true, file };
}

/**
 * A rejected server-side upload: the message AND the HTTP status to return. A
 * wrong file *type* is a 400 (bad request); an over-limit *size* is a 413 (the
 * one max-file-size contract — see FILE_TOO_LARGE_STATUS above). Carrying the
 * status here keeps the boundary's "too big" vs "wrong kind" distinction in one
 * place so the routes don't have to re-decide it.
 */
export type ServerUploadRejection = { status: number; error: string };

/**
 * The single server-side gate every uploaded CV / job-description / company File
 * passes through — the server twin of acceptUpload(). Where the client gates by
 * extension before the bytes upload, each Route Handler re-checks the MIME type
 * and size after they arrive, so the upload endpoints (/api/analyze and
 * /api/extract-text) can't drift on accepted types or size limits. `label`
 * names the offending input ("profile", "job description", "file", …) so the
 * error says which file to fix. Returns null when the file is accepted.
 *
 * Empty-MIME case (the gap idea-d902fc8e closed): some browsers report an empty
 * Content-Type for .md / extensionless files, so ACCEPT_MIME includes "". On its
 * own that let a direct POST with a blank Content-Type and ANY filename through
 * this gate, because the server never checked the extension — silently drifting
 * from the client, which gates by extension. So when the MIME channel carries no
 * signal (empty type), this falls back to the SAME EXTENSION_RE check
 * acceptUpload() uses, making the "client extension == server MIME" pairing a
 * real invariant rather than one the header comment only claimed.
 */
export function validateUploadServer(file: File, label: string): ServerUploadRejection | null {
  // An empty type is in ACCEPT_MIME (blank-Content-Type browsers), so for that
  // case require the filename to match EXTENSION_RE too — otherwise a blank
  // Content-Type alone would wave any file past the server's only type gate.
  const typeOk = ACCEPT_MIME.has(file.type) && (file.type !== "" || EXTENSION_RE.test(file.name));
  if (!typeOk) return { status: 400, error: `Use PDF, DOCX, TXT, or MD for the ${label}.` };
  if (file.size > MAX_FILE_BYTES) return { status: FILE_TOO_LARGE_STATUS, error: fileTooLargeMessage(label) };
  return null;
}

// ── The audio upload contract (voice-stt package, /api/stt) ─────────────────
// A SECOND ceiling, deliberately, and one status. Documents and audio are
// different kinds with different honest limits — 8 MB is a generous CV and a
// laughable interview clip, while the PDF/DOCX/TXT/MD type gate would reject
// every WAV ever recorded. What must NOT fork is how the boundary reports a
// refusal: "too big" is FILE_TOO_LARGE_STATUS (413) and "wrong kind" is 400
// wherever a file enters, so a client can branch on the status without knowing
// which endpoint it hit.
//
// The MIME list pairs with STT_MIME_TYPES in packages/voice-stt/src/types.ts —
// the package's validation door is the authority and this is the boundary copy,
// because this module is imported by client components and the package's index
// reaches node:fs. upload-constraints.test.ts asserts the two agree, so the copy
// cannot drift into accepting a container the door will reject.
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_AUDIO_MB = 25;

export const ACCEPT_AUDIO_MIME = new Set([
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
]);

/**
 * A rejected audio upload: the HTTP status AND a machine CODE, never a sentence.
 *
 * The difference from `ServerUploadRejection` above is the lesson §1.1 of
 * docs/architecture/api-contracts.md already wrote down: the client never
 * renders the server's English. `useErrorMessage()` resolves `errors.<CODE>` in
 * the reader's language, so a Czech operator whose 30 MB WAV is refused reads
 * Czech. Both codes are REFUSAL_ERRORS members — a refusal is a decision whose
 * message IS the information, and these two say which of the two things to fix.
 * The document gate above still answers sentences; converting it means every one
 * of ITS call sites at once, which is a different change.
 */
export type AudioUploadRejection = { status: number; code: "AUDIO_TOO_LARGE" | "AUDIO_UNSUPPORTED_TYPE" };

/**
 * The server gate for an uploaded audio File — the audio twin of
 * validateUploadServer, ending at the SAME 413 for size and 400 for type.
 * Returns null when the file is accepted.
 *
 * No empty-MIME fallback here, unlike the document gate: a browser recording
 * always carries a type, and audio has no short extension list worth trusting
 * in its place — an unnamed blob claiming nothing is refused rather than
 * guessed at, because guessing wrong means spawning a transcription engine or
 * spending a vendor's per-hour rate on a file that is not audio.
 */
export function validateAudioUploadServer(file: File): AudioUploadRejection | null {
  if (!ACCEPT_AUDIO_MIME.has(file.type)) return { status: 400, code: "AUDIO_UNSUPPORTED_TYPE" };
  if (file.size > MAX_AUDIO_BYTES) return { status: FILE_TOO_LARGE_STATUS, code: "AUDIO_TOO_LARGE" };
  return null;
}

/**
 * validateUploadServer for an optional form field: a missing or empty entry is
 * not an error (returns null); a present File is validated. Use for fields like
 * the job description or company overview that may be supplied as text instead.
 */
export function validateOptionalUploadServer(
  file: FormDataEntryValue | null,
  label: string,
): ServerUploadRejection | null {
  if (!(file instanceof File) || file.size === 0) return null;
  return validateUploadServer(file, label);
}
