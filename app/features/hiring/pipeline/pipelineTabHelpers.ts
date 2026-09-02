// Pure, React-free helpers for PipelineTab: localStorage keys, the saved-view
// id minting, and the bulk-action failure-reason reader. Split out so the tab's
// state hook stays focused on wiring, not these small self-contained utilities.

import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

// The URL params that encode a shared/deep board view. Their PRESENCE means the
// visitor followed an explicit link (a pasted share link or an analytics deep link),
// which always WINS over a saved default (views-earn-their-name): a bare visit falls
// back to the default, a linked visit opens exactly what the link encodes.
export const VIEW_PARAM_KEYS = ["q", "quick", "score", "source", "sort", "stage"] as const;

export const PIPELINE_VIEWS_KEY = "kp.pipelineViews";
export const PIPELINE_SLA_KEY = "kp.pipelineStageSla"; // per-stage aging overrides (PIPE4)

// A stable, opaque id for a NEW saved view — decoupled from the name so a rename
// preserves the view's identity (its default marking, its place in the list).
export function newViewId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return `v-${crypto.randomUUID()}`;
  } catch {
    /* crypto unavailable — fall through to the timestamp id */
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
