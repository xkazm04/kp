"use client";

import { useTranslations } from "next-intl";
import type { ApplySubmitError } from "./use-apply-submit";

/**
 * A failed final submit. The conversation and every captured answer above
 * stay intact; the recovery action matches WHY it failed (see the
 * ApplySubmitError contract): a transient blip re-POSTs the same answers,
 * while a server-rejected input restarts so the candidate can fix it.
 */
export function ApplyErrorBlock({
  error,
  submitting,
  onRetry,
  onRestart,
}: {
  error: ApplySubmitError;
  submitting: boolean;
  onRetry: () => void;
  onRestart: () => void;
}) {
  const t = useTranslations("apply");
  const tCommon = useTranslations("common");

  return (
    <div role="alert" className="mt-4 rounded-lg border border-coral/40 bg-coral/5 p-4">
      <p className="text-base text-coral">{error.message}</p>
      {error.retryable ? (
        <button
          type="button"
          disabled={submitting}
          onClick={onRetry}
          className="focus-ring mt-3 rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel disabled:opacity-50"
        >
          {submitting ? t("sending") : tCommon("retry")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRestart}
          className="focus-ring mt-3 rounded-md bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel"
        >
          {t("startOver")}
        </button>
      )}
    </div>
  );
}
