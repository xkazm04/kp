// grid-narrative-says-what-it-is (b). The grid's per-cell "why this score" request,
// lifted out of useMatrixTab so it can be CANCELLED and so a test can drive it with a
// fetch double.
//
// Why it had to move: /api/match/reasoning spawns the Python pipeline and, on a cache
// miss, spends an LLM call. Closing the popover left that spawn running to completion —
// the reader has already looked away, and the answer lands in a state nobody will read.
// A one-shot request needs an AbortSignal, and the hook had no seam to attach one to.
//
// The outcome is a three-way discriminated union rather than a throw, because "aborted"
// is not a failure: an aborted request must leave NO error on screen and must release
// the de-dupe key so re-opening the same cell tries again. Collapsing it into the catch
// branch is exactly how a deliberate close turns into a red error card.
import type { Reasoning } from "@/app/features/shared/matchTypes";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

export type ReasoningPayload = {
  reasoning?: Reasoning;
  source?: string;
  cached?: boolean;
  // The language the narrative was actually WRITTEN in — the engine only writes
  // en/cs, so a de/fr reader gets English and the UI has to say so.
  narrativeLang?: string;
};

export type ReasoningOutcome =
  | { status: "ok"; payload: ReasoningPayload }
  /** The route answered non-2xx. `body` is the parsed error body — the CALLER resolves
   *  its machine `code` through useErrorMessage; this module never renders a message. */
  | { status: "failed"; body: ApiErrorPayload }
  | { status: "aborted" };

/** True for the DOMException a fetch abort rejects with, in both the browser and node
 *  (where `AbortError` arrives as a plain-ish error with that name). */
export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    ((e as { name?: string }).name === "AbortError" || (e as { code?: string }).code === "ABORT_ERR")
  );
}

export async function fetchMatchReasoning(
  input: { profileId: string; jobId: string; lang: string },
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<ReasoningOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const r = await doFetch("/api/match/reasoning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: opts.signal,
    });
    // An abort can land between the response and the body read; check before parsing so
    // a cancelled request never resolves as ok.
    if (opts.signal?.aborted) return { status: "aborted" };
    const body = (await r.json().catch(() => ({}))) as ApiErrorPayload;
    if (!r.ok) return { status: "failed", body };
    return { status: "ok", payload: body as ReasoningPayload };
  } catch (e) {
    if (isAbortError(e) || opts.signal?.aborted) return { status: "aborted" };
    return { status: "failed", body: {} };
  }
}
