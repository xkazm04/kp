// Split a multi-ad paste into individual job ads (idea-efb12f90). A recruiter
// onboarding a whole req list pastes several ads separated by a line of dashes
// (--- / ———) — the universal "page break" separator. Each chunk is
// trimmed; chunks below the ingest floor are dropped so a stray separator or a
// trailing blank doesn't become an empty parse. Pure so the split contract is
// unit-testable and the panel can preview the count before importing.

// The ingest floor — shorter than this isn't a real ad. Single source of truth
// for the client panel guard, this splitter, and the ingest route's server guard,
// which must agree or a chunk one keeps gets rejected by the other.
export const MIN_AD_CHARS = 30;

// A separator line: 3+ DASHES (ascii -, em —, en –) on their own line (optional
// surrounding whitespace). Multiline so it matches per line within the paste.
// bug-ui-scan-2026-07-09 (job-postings-lifecycle #3): the alphabet was
// `[-—_=*]`, which collided with ordinary in-body markdown a single ad routinely
// contains — a setext heading underline (`===`/`---`), an `___`/`***` thematic
// break — fragmenting ONE pasted ad into several garbage jobs. Dashes are the only
// glyph the UI advertises as the divider ("a line of ---"), so restricting the
// alphabet to dashes drops the `= _ *` false-positives while keeping the documented
// contract. (A short heading underlined with `---`, e.g. `Title\n---`, still can't
// be a spurious ad because the sub-30-char `Title` chunk is dropped by the floor.)
const SEPARATOR = /^[ \t]*[-—–]{3,}[ \t]*$/m;

/** Split `text` into individual ads on separator lines, trimmed, dropping chunks
 *  below the ingest floor. A single ad (no separators) returns one chunk; empty
 *  input returns []. */
export function splitJobAds(text: string): string[] {
  return text
    .split(SEPARATOR)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= MIN_AD_CHARS);
}
