// What a reconnect after a dropped call continues from (spark ai-interview-parity).
//
// STUB — WP1b (the director engine) replaces the body: it reads the session's
// persisted `interview_events` (turns of earlier attempts, topic_begun/topic_covered)
// and returns the prior turns (most recent 40, oldest first), the active and covered
// blocks, and the live seconds already spent. Until then every connect is a fresh
// start, which is exactly today's behaviour.

import type { ResumeContext } from "./director-types";

/** Resume context for the attempt a connect is about to open, or null when there is
 *  nothing to resume (a first connect, or no persisted turns). Workspace-scoped like
 *  every other read of the session's events. */
export function buildResumeContext(sessionId: string, workspaceId: string): ResumeContext | null {
  void sessionId;
  void workspaceId;
  return null;
}
