"use client";

import { useRef, useState } from "react";
import { readApplySession } from "@/app/_lib/apply-session-client";
import type { CompletenessGap } from "@/app/_lib/completeness-followup";
import { applyNetworkFailure, applySubmitFailure, type ApplySubmitError } from "./apply-submit-outcome";
import type { ApplyOutcome } from "./apply-chat-types";

// A FAILED final submit — recoverable, rendered inline so the conversation and
// every captured answer survive a blip on the last step. The recovery ACTION
// depends on WHY it failed; the decision itself (what we say, whether a re-POST
// can help, which step to re-ask) is pure — see apply-submit-outcome.ts:
//   - retryable (network / 5xx / 408 / 429): a "Try again" that re-POSTs the
//     already-collected answers — the candidate never re-walks the chat.
//   - not retryable but the refusal NAMES the answer it rejected (`field`): the
//     door re-asks THAT step with the typed answer still in the box, so a name
//     two characters over the cap costs one edit, not the whole conversation.
//   - not retryable and unattributable: "Start over", resetting to the first
//     question in place (no page reload) — the last resort, not the first answer.
// (There is no longer a fatal load-error state: the script arrives as a prop,
// server-built.)
export type { ApplySubmitError } from "./apply-submit-outcome";

/**
 * The final POST and everything that hangs off its outcome: the in-flight flag,
 * the recoverable failure, and the accepted/declined result the done card and
 * the follow-up block read.
 *
 * Copy arrives already localized (`submitFailedMessage`, `networkFailedMessage`)
 * and the error resolver is passed in, because `useTranslations` cannot be
 * called from a module that has no component around it — see useErrorMessage's
 * own note on taking a bound resolver as a parameter.
 */
export function useApplySubmit({
  jobId,
  lead,
  submitFailedMessage,
  networkFailedMessage,
  hasErrorCode,
  translateErrorCode,
  fixableStepIds,
}: {
  jobId: string;
  /** The enrichment lead token, or null when this is a first-time visit. */
  lead: string | null;
  submitFailedMessage: string;
  networkFailedMessage: string;
  /** The `errors` catalog, unbound from React — a refusal is rendered from its
   *  CODE in the candidate's language, never from the server's English string. */
  hasErrorCode: (code: string) => boolean;
  translateErrorCode: (code: string, values: { max: number | string }) => string;
  /** Step ids this visit's script asked — the only fields a re-ask can address. */
  fixableStepIds: readonly string[];
}) {
  const [done, setDone] = useState<ApplyOutcome | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<ApplySubmitError | null>(null);
  // The fully-collected answers from the final step, kept so "Try again" can
  // re-submit them directly — bypassing advance()'s answeredRef guard, which has
  // already marked the final step answered and would otherwise block a resend.
  const finalAnswersRef = useRef<Record<string, unknown> | null>(null);

  // POST the completed application. Failures set `submitError` — rendered inline,
  // recoverable — so a transient last-step blip never destroys the conversation.
  // `finalAnswers` is remembered so "Try again" can re-POST the same payload
  // without re-walking the chat.
  const submitApplication = async (finalAnswers: Record<string, unknown>) => {
    finalAnswersRef.current = finalAnswers;
    // Don't clear submitError up front: on a retry that keeps the inline error
    // block (now showing "Sending…") in place instead of flashing the answered
    // step's disabled controls. A success swaps in `done`; a failure overwrites it.
    setSubmitting(true);
    try {
      const res = await fetch(`/api/apply/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The lead token (when this is an enrichment visit) targets the merge at
        // the lead's own entry server-side; the server re-validates it and falls
        // back to email/name identity when it's absent or stale.
        // applySessionId links this submission back to the start row so the
        // apply-to-pipeline rate has both halves; absent when localStorage is
        // unavailable, in which case the attempt simply stays unlinked.
        body: JSON.stringify({
          answers: finalAnswers,
          ...(lead !== null ? { lead } : {}),
          applySessionId: readApplySession(jobId, "chat"),
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setDone({
          result: d.result,
          message: d.message,
          duplicate: Boolean(d.duplicate),
          enriched: Boolean(d.enriched),
          statusToken: d.statusToken ?? null,
          followupToken: typeof d.followupToken === "string" ? d.followupToken : null,
          followupGaps: Array.isArray(d.followupGaps) ? (d.followupGaps as CompletenessGap[]) : undefined,
        });
      } else {
        // The server rejected the submit. What we SAY (the refusal's code,
        // localized, carrying the cap it sent as data) and what we OFFER (retry /
        // re-ask one step / start over) are one pure decision.
        setSubmitError(
          applySubmitFailure({
            status: res.status,
            body: d,
            fallbackMessage: submitFailedMessage,
            hasErrorCode,
            translateErrorCode,
            fixableStepIds,
          })
        );
      }
    } catch {
      // No HTTP response at all (offline / network blip) — always retryable.
      setSubmitError(applyNetworkFailure(networkFailedMessage));
    } finally {
      setSubmitting(false);
    }
  };

  // Re-POST the already-collected final answers after a RETRYABLE failure. Goes
  // straight to submitApplication (not advance), since the final step is already
  // in answeredRef and advance() would no-op.
  const retrySubmit = () => {
    if (submitting || !finalAnswersRef.current) return;
    submitApplication(finalAnswersRef.current);
  };

  // Forget everything this hook knows about the last attempt — the submit half of
  // a start-over. Clearing the remembered final answers is what lets the candidate
  // re-walk every step and submit fresh input; clearing `done` also clears a
  // DECLINED outcome, so a mis-tapped knockout on the last step isn't terminal.
  const resetSubmit = () => {
    finalAnswersRef.current = null;
    setSubmitError(null);
    setDone(null);
  };

  // Drop ONLY the inline failure, keeping the remembered answers and the
  // conversation — what a "fix this answer" re-ask needs: the door puts the
  // rejected step back on screen in place of the error block.
  const clearSubmitError = () => setSubmitError(null);

  return { done, submitting, submitError, submitApplication, retrySubmit, resetSubmit, clearSubmitError };
}
