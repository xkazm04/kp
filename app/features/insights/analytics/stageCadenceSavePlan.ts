// The dwell band's in-place cadence write, as a pure plan (challenge-r05
// analytics-metrics/B). The input itself is InlineNumberSave (parse, zero-is-clear,
// unchanged short-circuit — inlineNumberSavePlan.ts); this module owns the two halves
// that are specific to a cadence:
//
//  1. THE REQUEST. One column, through the r03 route PATCH /api/pipeline/stage-sla —
//     the same door the board's cadence editor uses, which applies the edit inside
//     the store's IMMEDIATE read-modify-write, so this write can only change the one
//     value it names. `null` clears the team's value back to the role default.
//  2. THE REFUSAL. The route answers a CODE. DECISION_CONFIG_INVALID's catalog line is
//     written for the Settings rule editor ("Those rules aren't valid for this phase."),
//     which tells someone who typed 400 into a days field nothing; the plan maps that
//     code to the band's own sentence (the bounds). Every other code — the capability
//     refusal for a seat without pipeline:write, the save failure — resolves through
//     the errors catalog. The server's English `error` is never the answer.
//
// Free of React and next-intl: the resolver and the two sentences arrive as
// parameters, so a test executes the mapping against the real catalogs.
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

export const STAGE_CADENCE_ROUTE = "/api/pipeline/stage-sla";

export function cadenceSaveRequest(stage: string, days: number | null): { url: string; init: RequestInit } {
  return {
    url: STAGE_CADENCE_ROUTE,
    init: {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage, days }),
    },
  };
}

/** A failed cadence save → the sentence the field shows, already localized. */
export function cadenceFailureMessage(
  payload: ApiErrorPayload | null | undefined,
  resolveError: (payload: ApiErrorPayload | null | undefined, fallback: string) => string,
  invalidMessage: string,
  fallback: string
): string {
  if (payload?.code === "DECISION_CONFIG_INVALID") return invalidMessage;
  return resolveError(payload, fallback);
}
