import { isRetryableApplyStatus } from "@/app/_lib/apply-intake";

/*
 * What a failed apply submit MEANS — the whole decision, pure and in one place,
 * so both candidate doors (the chat and the quick form) answer a refusal the
 * same way and the logic is testable without a DOM.
 *
 * Three questions, in this order:
 *
 *   1. WHAT DO WE SAY? The refusal's machine `code`, resolved through the
 *      `errors` catalog in the candidate's language — with the cap the server
 *      sent as DATA (`max`), so "too long" can say how long. Only when there is
 *      no code, or none we have a message for, does the caller's already
 *      localized fallback run. The server's English `error` string is never
 *      read (see use-error-message.ts for the rule this follows). The quick
 *      form used to decide the message from the STATUS first — every throttled
 *      or rejected submit read "something went wrong" in all four languages
 *      even when the route had named the reason.
 *   2. CAN A RE-POST HELP? `isRetryableApplyStatus` — the shared contract, so a
 *      5xx/408/429 offers "Try again" with the answers already collected.
 *   3. IF NOT, WHAT CAN THE CANDIDATE FIX? A validation 400 names the offending
 *      answer (`field`, a step id). When that step is one this script actually
 *      asked, the door re-asks THAT question with the typed answer still in the
 *      box — the step is repairable, not a restart. A restart is the last
 *      resort, not the first response to a name two characters over the cap.
 */

/** The parsed error body of a failed apply POST. Every field is untrusted:
 *  `code`/`field` are shape-gated below and `error` is deliberately never read. */
export type ApplyFailureBody = { code?: unknown; field?: unknown; max?: unknown; error?: unknown } | null | undefined;

/** A FAILED submit — recoverable, rendered inline so the conversation and every
 *  captured answer survive. `fixStepId` is the step to re-ask (null when there
 *  is nothing specific to fix). */
export type ApplySubmitError = { message: string; retryable: boolean; fixStepId: string | null };

export function applySubmitFailure({
  status,
  body,
  fallbackMessage,
  hasErrorCode,
  translateErrorCode,
  fixableStepIds = [],
}: {
  status: number;
  body: ApplyFailureBody;
  /** Already localized by the caller — used only when no code resolves. */
  fallbackMessage: string;
  hasErrorCode: (code: string) => boolean;
  /** Bound `errors` translator. `max` rides along because the cap-carrying
   *  messages interpolate it; the codes without a cap simply ignore it. */
  translateErrorCode: (code: string, values: { max: number | string }) => string;
  /** The step ids this visit's script actually asked — the only fields a
   *  re-ask can address. */
  fixableStepIds?: readonly string[];
}): ApplySubmitError {
  const code = typeof body?.code === "string" ? body.code : null;
  const max = typeof body?.max === "number" || typeof body?.max === "string" ? body.max : "";
  const message = code && hasErrorCode(code) ? translateErrorCode(code, { max }) : fallbackMessage;
  const retryable = isRetryableApplyStatus(status);
  const field = typeof body?.field === "string" ? body.field : null;
  // A retryable failure is retried, never re-typed: the input was not the problem.
  const fixStepId = !retryable && field && fixableStepIds.includes(field) ? field : null;
  return { message, retryable, fixStepId };
}

/** No HTTP response at all (offline / network blip) — always retryable, and
 *  there is nothing to fix because nothing was judged. */
export function applyNetworkFailure(message: string): ApplySubmitError {
  return { message, retryable: true, fixStepId: null };
}
