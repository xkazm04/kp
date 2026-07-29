// Pure, React-free helpers for PipelineTab: localStorage keys, the saved-view
// id minting, and the bulk-action failure-reason reader. Split out so the tab's
// state hook stays focused on wiring, not these small self-contained utilities.

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

// Read the server's OWN explanation from a failed pipeline action response — the
// 409 "changed since you opened it" (a concurrent actor moved them) vs the 422
// "route through Offer → extend an offer" (a forbidden transition) guidance the
// recruiter actually needs, distinguished because the route returns a different
// message per status. Surfaced verbatim, the same way the drawer's moveStage
// does (PipelineCandidateDrawer.tsx). Returns null when the body carries no reason
// (a network throw / opaque error), so the caller falls back to its localized copy.
export async function pipelineActionReason(r: Response): Promise<string | null> {
  try {
    const d = (await r.json()) as { error?: unknown };
    return typeof d?.error === "string" && d.error.trim() ? d.error : null;
  } catch {
    return null;
  }
}
