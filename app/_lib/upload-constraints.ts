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

/**
 * Client-side pre-flight check (by extension + size) so a bad file is rejected
 * at the drop/select moment with an inline message, instead of only failing
 * after the upload round-trips to the server. Returns an error string or null.
 */
export function validateUpload(file: File): string | null {
  if (!EXTENSION_RE.test(file.name)) return "Use a PDF, DOCX, TXT, or MD file.";
  if (file.size > MAX_FILE_BYTES) return `File exceeds the ${MAX_FILE_MB} MB limit.`;
  return null;
}
