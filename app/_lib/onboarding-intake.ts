// Pure pre-boarding intake helpers, extracted so the empty-submit guard is unit-testable
// (bug-ui-scan-2026-07-09 offers-onboarding #2). The candidate-facing submit filters raw
// answers to the run's allowed questionnaire keys and treats an all-blank payload as "no
// submission": an empty payload must NOT create an intake row, because an intake row both
// marks the hire falsely "submitted" AND permanently suppresses the one-shot pre-boarding
// reminder (onboarding-store.duePreboardingReminders excludes any run that has an intake
// row). Kept side-effect-free (no DB / no clock) so it mirrors offer-policy.ts's testability.

/** Keep only allowed, non-blank string answers — the server trust boundary for the
 *  candidate's questionnaire submit. */
export function cleanIntakeAnswers(
  answers: Record<string, unknown>,
  allowedKeys: Iterable<string>
): Record<string, string> {
  const allowed = new Set(allowedKeys);
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (allowed.has(k) && typeof v === "string" && v.trim()) clean[k] = v;
  }
  return clean;
}

/** True when at least one answer carries non-whitespace content. Drives the client's
 *  submit-enable guard and the server's "don't persist an empty intake" no-op. */
export function hasAnyIntakeAnswer(answers: Record<string, string | undefined | null>): boolean {
  return Object.values(answers).some((v) => typeof v === "string" && v.trim().length > 0);
}
