// Single source of truth for the repo-signal code-review status enum. The zod
// schema (schemas.ts) builds its enum from this list and the logger derives its
// union type from it, so the set of valid statuses lives in exactly one place.
// Kept import-free so the Node unit runner can load it directly (schemas.ts
// transitively imports generated modules the runner can't resolve).
//
// Four mutually-exclusive outcomes, each self-describing so a reader never has
// to inspect the `summary` string to know what actually happened:
//   disabled — no GEMINI_API_KEY, the review never ran.
//   empty    — the review ran but there were no owned public repos to review
//              (a successful "nothing to review", NOT evidenced-skills data).
//   ok       — a real Gemini review produced evidenced skills.
//   error    — the review was attempted but failed (fetch / model / parse).
export const CODE_REVIEW_STATUSES = ["disabled", "empty", "ok", "error"] as const;

export type CodeReviewStatus = (typeof CODE_REVIEW_STATUSES)[number];
