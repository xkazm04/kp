// Single source of truth for CV/JD file-upload constraints, shared between the
// client drop zones (which gate by extension) and the server route (which gates
// by MIME). Keep the two channels paired here so they can't drift.

export const ACCEPT_EXTENSIONS = ".pdf,.docx,.txt,.md";

export const ACCEPT_MIME = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "", // some browsers report an empty type for .md / extensionless files
]);

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_MB = 8;
export const MAX_FILE_HINT = "PDF · DOCX · TXT · MD up to 8 MB";
export const MAX_CV_VARIANTS = 3;

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
 * here via the `useFileAccept` hook; see app/features/sub_analyze/useFileAccept.ts.
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
