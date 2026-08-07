// Single source of truth for the GitHub deep-review evidence budget and the
// human-readable description of it. The /api/github-analysis route fetches repo
// signals against these limits (fetchRepoBundle) and surfaces
// describeEvidenceBasis() in the codeReview payload; the e2e fixture asserts the
// SAME strings. Both import from here so a truncation/limit change can never
// desync production from the e2e expectation — the fixture used to bake the
// numbers (3500 / 10 / 30) in by value, defeating the type-shared contract.
//
// Zero dependencies on purpose: this module is imported by both server route
// code and the Playwright fixture, so it must stay safe to load in any context.

// README text kept per repo, in characters.
export const README_TRUNCATE = 3500;
// Recent commit SUBJECT lines kept per repo (first line of each message).
export const COMMITS_PER_REPO = 10;
// Root-level file/directory NAMES kept per repo — names only, never file contents.
export const FILES_PER_REPO = 30;

// --- Findings: analysis results as DATA, not as prose ------------------------
//
// The analysis emits a fixed, enumerable set of observations (six complexity
// signals, three complexity verdicts, four contribution lines, five limitations,
// five evidence-basis lines). Those are structured data wearing a sentence, so
// they travel as `{ kind, params }` and the PANEL renders them from the
// `results.github.finding` catalog in the reader's language — the same way an
// API failure travels as a `code`, not as English. Nothing server-side composes
// a sentence a user reads.
//
// `kind` is a key path inside `results.github.finding`; `params` are the raw
// values ICU formats (numbers stay numbers so plurals and grouping work).
export type GithubFinding = { kind: string; params?: Record<string, string | number> };

/** A finding, or — for a payload persisted before findings existed — the frozen
 *  English sentence that run produced. Stored analyses are re-parsed and
 *  re-rendered years later, so the reader tolerates both and renders a legacy
 *  string verbatim. */
export type GithubNote = string | GithubFinding;

// FINDING #2 (bug-ui-scan-2026-07-09): the shared "could not determine" limitation
// the /api/github-analysis route appends when some public GitHub data was throttled
// away this run. Exported as ONE finding so the route (producer) and
// GithubAnalysisPanel (consumer — it keys its Potential-Gaps "could not determine"
// caveat off this) can never drift. Lives here because this module is already the
// dependency-free evidence-vocabulary source shared by the server route, the client
// components and the Playwright fixture.
export const EVIDENCE_INCOMPLETE: GithubFinding = { kind: "limitation.evidenceIncomplete" };

// The sentence this limitation used to BE, before it became a finding. Not copy —
// a marker for recognizing it in an analysis persisted back then, so a stored
// report keeps suppressing its "no gaps" reassurance. Never rendered from here.
const LEGACY_EVIDENCE_INCOMPLETE_NOTE =
  "Some public GitHub data couldn't be fetched this run (likely rate limiting), so language coverage and skill-gap detection are incomplete — retry shortly for a complete read.";

/** Did this run lose coverage? The one place that knows how the note is spelled. */
export function hasEvidenceIncomplete(notes: readonly GithubNote[]): boolean {
  return notes.some((note) =>
    typeof note === "string" ? note === LEGACY_EVIDENCE_INCOMPLETE_NOTE : note.kind === EVIDENCE_INCOMPLETE.kind
  );
}

// The exact, deterministic evidence the deep review is built from. Derived from
// the constants above so the documented scope can NOT drift from what is actually
// sent to the model. Text-and-metadata only: no file *bodies* and no recursive
// directory tree are ever read, so neither the model nor the UI may imply the
// source code itself was inspected.
export function describeEvidenceBasis(): GithubFinding[] {
  return [
    { kind: "basis.readme", params: { chars: README_TRUNCATE } },
    { kind: "basis.commits", params: { count: COMMITS_PER_REPO } },
    { kind: "basis.files", params: { count: FILES_PER_REPO } },
    { kind: "basis.metadata" },
    { kind: "basis.notRead" },
  ];
}
