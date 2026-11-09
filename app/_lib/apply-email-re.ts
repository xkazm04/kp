/**
 * The one email-shape check the apply door, the ATS ingest and the workspace
 * review contact share. A leaf module on purpose: no imports, so a store module
 * can take the pattern without pulling apply-intake's graph into every reader
 * (perf-budget.json: job-ingest and llm-config reach db/workspaces).
 * apply-intake re-exports it, so existing importers do not change.
 */
export const APPLY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
