import { ensureDb } from "./db/core";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import type { FeedbackSubmission } from "./feedback";

// Recruiter feedback door — storage. Validation is pure and lives in
// feedback.ts (the candidate-nps split); this file only reads and writes.
// Workspace-scoped on every path (tenancy manifest: feedback-tenancy.test.ts).

export type FeedbackRow = {
  id: number;
  message: string;
  email: string | null;
  route: string | null;
  appVersion: string | null;
  createdAt: string;
};

/** Persist one submission. `submission` must already have passed
 *  parseFeedbackSubmission — this writes what it is given. */
export function recordFeedback(
  submission: FeedbackSubmission & { appVersion: string | null },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  ensureDb()
    .prepare(
      `INSERT INTO feedback (message, email, route, app_version, workspace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      submission.message,
      submission.email,
      submission.route,
      submission.appVersion,
      workspaceId,
      new Date().toISOString()
    );
}

/** Newest-first read for the operator view (/control). Bounded so a caller can
 *  never pull the whole table into a response. */
export function listFeedback(limit = 50, workspaceId: string = DEFAULT_WORKSPACE_ID): FeedbackRow[] {
  return (
    ensureDb()
      .prepare(
        `SELECT id, message, email, route, app_version, created_at FROM feedback
         WHERE workspace_id = ?
         ORDER BY created_at DESC, id DESC LIMIT ?`
      )
      .all(workspaceId, Math.min(200, Math.max(1, limit))) as {
      id: number;
      message: string;
      email: string | null;
      route: string | null;
      app_version: string | null;
      created_at: string;
    }[]
  ).map((r) => ({
    id: r.id,
    message: r.message,
    email: r.email,
    route: r.route,
    appVersion: r.app_version,
    createdAt: r.created_at,
  }));
}
