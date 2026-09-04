// The fold every inline analytics write shares: a failed Response → an
// ALREADY-LOCALIZED failure the input can render verbatim.
//
// WHY IT IS A MODULE. `AnalyticsChannelSpendInput` worked this out first
// (read the body, resolve the `code` through `useErrorMessage`, throw a
// `LocalizedFailure`) and `AnalyticsTargetInput` — the goal editor sitting two
// inches away, writing the goal lines every figure on the tab is judged against
// — still threw `new Error()`. A bare Error carries nothing: the recruiter whose
// seat may not run recruiter operations (ANALYTICS_POLICY_FORBIDDEN, 403) and the
// recruiter whose write fell over (ANALYTICS_TARGET_SAVE_FAILED, 500) got the same
// coral border and the same flat tooltip, and the goal they had just set was gone
// either way. The route answers a CODE for both (api-contracts.md §1.1).
//
// Kept free of React and next-intl on purpose (like calibrationVerdict.ts): the
// resolver arrives as a PARAMETER, so the fold is executed by a test instead of
// being asserted by reading a .tsx as text.
import { apiErrorPayload, LocalizedFailure } from "./analyticsFetchError";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";

/**
 * Resolve a failed response into a `LocalizedFailure`.
 *
 * `resolve` is the bound `useErrorMessage()` resolver from the component; `fallback`
 * is the caller's own already-localized sentence, used when the failure carries no
 * code we know (a body-less 502, a proxy timeout). The server's English `error`
 * string is never part of the result — that is the whole rule.
 */
export async function localizedSaveFailure(
  res: Response,
  resolve: ErrorMessageResolver,
  fallback: string
): Promise<LocalizedFailure> {
  return new LocalizedFailure(resolve(await apiErrorPayload(res), fallback));
}
