// Single source of truth for dev-case intake constraints, shared between the
// client NeedForm (which caps the repo-input list) and the server analyze run
// (which clamps codebaseRefs before snapshotting). Keep both gates paired here
// so they can't drift — same pattern as upload-constraints.ts.

// A role can span a few codebases (multi-repo analysis), but each snapshot costs
// GitHub API calls and prompt budget — cap the grounding set.
export const MAX_CODEBASES = 3;
