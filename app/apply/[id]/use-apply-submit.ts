"use client";

import { useRef, useState } from "react";
import { isRetryableApplyStatus } from "@/app/_lib/apply-intake";
import { readApplySession } from "@/app/_lib/apply-session-client";
import type { CompletenessGap } from "@/app/_lib/completeness-followup";
import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";
import type { ApplyOutcome } from "./apply-chat-types";

// A FAILED final submit — recoverable, rendered inline so the conversation and
// every captured answer survive a blip on the last step. The recovery ACTION
// depends on WHY it failed (see isRetryableApplyStatus):
//   - retryable (network / 5xx / 408 / 429): a "Try again" that re-POSTs the
//     already-collected answers — the candidate never re-walks the chat.
//   - not retryable (the server rejected the input — e.g. an answer too long, a
//     payload too large): re-POSTing the identical payload would fail the same
//     way forever, so the only honest path is a "Start over" that resets to the
//     first question in place (no full page reload).
// (There is no longer a fatal load-error state: the script arrives as a prop,
// server-built.)
export type ApplySubmitError = { message: string; retryable: boolean };

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
  errMsg,
}: {
  jobId: string;
  /** The enrichment lead token, or null when this is a first-time visit. */
  lead: string | null;
  submitFailedMessage: string;
  networkFailedMessage: string;
  errMsg: ErrorMessageResolver;
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
        // The server rejected the submit. isRetryableApplyStatus decides whether a
        // re-POST of the same answers could succeed (5xx / transient) or is futile
        // (4xx — the input itself was rejected), which selects Try-again vs Start-over.
        setSubmitError({
          message: errMsg(d, submitFailedMessage),
          retryable: isRetryableApplyStatus(res.status),
        });
      }
    } catch {
      // No HTTP response at all (offline / network blip) — always retryable.
      setSubmitError({
        message: networkFailedMessage,
        retryable: true,
      });
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

  return { done, submitting, submitError, submitApplication, retrySubmit, resetSubmit };
}
