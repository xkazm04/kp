"use client";

import { useTranslations } from "next-intl";
import { BTN_PRIMARY } from "@/app/_components/ui/recipes";
import type { ApplySubmitError } from "./use-apply-submit";

/**
 * A failed final submit. The conversation and every captured answer above stay
 * intact; the recovery action matches WHY it failed (see the ApplySubmitError
 * contract, decided in apply-submit-outcome.ts):
 *   - a transient blip re-POSTs the same answers,
 *   - a refusal that NAMED the answer it rejected re-asks that one step, with
 *     the rejected value still in the box,
 *   - anything else restarts, which is the last resort rather than the standard
 *     answer to a name two characters over the cap.
 */
export function ApplyErrorBlock({
  error,
  submitting,
  onRetry,
  onFix,
  onRestart,
}: {
  error: ApplySubmitError;
  submitting: boolean;
  onRetry: () => void;
  onFix: (stepId: string) => void;
  onRestart: () => void;
}) {
  const t = useTranslations("apply");
  const tCommon = useTranslations("common");

  return (
    <div role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/5 p-4">
      <p className="text-base text-coral">{error.message}</p>
      {error.retryable ? (
        <button type="button" disabled={submitting} onClick={onRetry} className={`${BTN_PRIMARY} mt-3 h-10 px-4`}>
          {submitting ? t("sending") : tCommon("retry")}
        </button>
      ) : error.fixStepId ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => onFix(error.fixStepId as string)}
          className={`${BTN_PRIMARY} mt-3 h-10 px-4`}
        >
          {t("fixAnswer")}
        </button>
      ) : (
        <button type="button" onClick={onRestart} className={`${BTN_PRIMARY} mt-3 h-10 px-4`}>
          {t("startOver")}
        </button>
      )}
    </div>
  );
}
