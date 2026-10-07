// Pure, React-free helpers for PipelineTab: the refused-action reason reader. Split out so the tab's
// state hook stays focused on wiring, not these small self-contained utilities.

import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

// The board's two localStorage memories used to be declared here as GLOBAL keys.
// They are now workspace-scoped and live in pipelineBoardStorage.ts — see the leak
// note there (board-storage-is-keyed-by-tenant).

// Read the server's machine-readable REFUSAL from a failed pipeline action response:
// the 409 PIPELINE_MOVE_CONFLICT ("changed since you opened it" — a concurrent actor
// moved them) vs the 422 PIPELINE_TERMINAL_NOT_MANUAL ("route through the offer flow"
// — a forbidden transition) the recruiter actually needs to tell apart.
//
// Returns the {error, code} PAYLOAD, not the server's sentence: the caller resolves it
// through useErrorMessage, so a Czech board reads Czech. This used to return `error`
// verbatim and drop `code` on the floor, which painted the route's canonical English on
// every localized board — exactly the inverted fallback chain use-error-message.ts
// exists to end. Returns null when the body carries no reason at all (a network throw /
// opaque error), so the caller falls back to its own localized copy.
export async function pipelineActionReason(r: Response): Promise<ApiErrorPayload | null> {
  try {
    const d = (await r.json()) as ApiErrorPayload;
    const hasCode = typeof d?.code === "string" && d.code.trim() !== "";
    const hasError = typeof d?.error === "string" && d.error.trim() !== "";
    return hasCode || hasError ? d : null;
  } catch {
    return null;
  }
}
