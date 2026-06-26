// Pure (no next/headers, no DB) so it's safe to import from server libs (screen-wave)
// AND route handlers without dragging request-scope imports into the lib bundle.

/** The human approver name written into a sealed adverse-decision record (Art.22 /
 *  EU-AI-Act human-in-the-loop) when the request doesn't carry one. The app is
 *  single-operator (one KP_OPERATOR_PASSWORD, no per-user identity), so the prior
 *  hardcoded "operator (in-app approval)" named NOBODY in the immutable record — the
 *  central "who reviewed this" claim was a constant string for every in-app commit.
 *  Name the actual reviewer via KP_OPERATOR_NAME for a defensible record; absent that,
 *  state the posture honestly rather than imply a specific person reviewed it. */
export function operatorApprover(): string {
  return process.env.KP_OPERATOR_NAME?.trim() || "operator (single-operator deployment)";
}
