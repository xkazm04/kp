// Split a multi-ad paste into individual job ads (idea-efb12f90). A recruiter
// onboarding a whole req list pastes several ads separated by a line of dashes
// (--- / ——— / ___) — the universal "page break" separator. Each chunk is
// trimmed; chunks below the ingest floor are dropped so a stray separator or a
// trailing blank doesn't become an empty parse. Pure so the split contract is
// unit-testable and the panel can preview the count before importing.

// The ingest route's floor — shorter than this isn't a real ad (mirrors the
// MIN_AD_CHARS in IngestAdPanel / the route's 30-char guard).
const MIN_AD_CHARS = 30;

// A separator line: 3+ of -, —, _, =, or * on their own line (optional surrounding
// whitespace). Multiline so it matches per line within the paste.
const SEPARATOR = /^[ \t]*[-—_=*]{3,}[ \t]*$/m;

/** Split `text` into individual ads on separator lines, trimmed, dropping chunks
 *  below the ingest floor. A single ad (no separators) returns one chunk; empty
 *  input returns []. */
export function splitJobAds(text: string): string[] {
  return text
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= MIN_AD_CHARS);
}
