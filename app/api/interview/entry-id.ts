// The entry-id trust-boundary reading, written ONCE.
//
// Four interview doors take a pipeline entry id off a JSON body — /create (twice:
// `entryId` and the dev-case `submissionId`), /revoke and /simulate/attach — and
// each had re-typed the same three-clause narrowing inline: "a string, trimmed,
// non-empty, and no longer than 120 characters". Four copies of one rule is four
// places for it to drift, and the rule is load-bearing: the value goes straight
// into an indexed SQLite lookup, so an unbounded attacker-controlled string is
// both a query-amplification and a log-flooding surface (idea-c7df6b55).
//
// Deliberately a NARROWER, not a validator that throws: the callers answer
// different refusals (INTERVIEW_ENTRY_REQUIRED on the recruiter doors, a
// token+entry 400 on attach), and a helper that picked the status for them would
// have to know all four.

/** Ids in this codebase are `randomId()` prefixed slugs; 120 is far above any real
 *  one and far below anything that costs to look up. */
export const MAX_ID_LEN = 120;

/** The trimmed id, or `null` when the value is absent, not a string, empty, or
 *  implausibly long. */
export function readEntityId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ID_LEN) return null;
  return trimmed;
}
