"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, RotateCw, X } from "lucide-react";
import { BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { ApiFailureKind } from "./apiFailure";

// The ONE failure block of the seeker surfaces (/me/jobs, /me/sources, /me/scans).
//
// Failure is spelled apart from empty success: this is a critical NOTICE with
// `role="alert"` and a Retry that re-issues the SAME request, never a panel that
// stands in for an empty state and never a bare red line that the reader cannot act
// on. The sentence is resolved by CODE (use-error-message.ts); a TRANSPORT fault —
// no JSON at all — gets its own sentence, because "could not be loaded" is not what
// a reader whose server is down needs to read.
//
// The caller owns the retry: only the caller knows which request failed.

export function FailureNotice({
  failure,
  fallback,
  onRetry,
  onDismiss,
  retrying = false,
  className = "",
}: {
  /** The classified failure; `null`/absent renders `fallback` as the sentence. */
  failure?: { kind?: ApiFailureKind; code?: string | null } | null;
  /** The surface's own already-localized sentence for a failure with no usable code. */
  fallback: string;
  onRetry?: () => void;
  /** A failure the reader may put away without acting on it (a write that left the
   *  page where it was). Absent = the notice stays until the next attempt clears it. */
  onDismiss?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const t = useTranslations("me.common");
  const tCommon = useTranslations("common");
  const resolveError = useErrorMessage();
  const sentence = failure?.kind === "transport" ? t("unreachable") : resolveError(failure, fallback);
  return (
    <div className={`${NOTICE("critical")} px-3 py-2.5 text-sm ${className}`} role="alert">
      <p className="flex items-start gap-1.5">
        <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
        <span>{sentence}</span>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} aria-label={tCommon("dismissNotification")} className="focus-ring ml-auto shrink-0 rounded-md p-0.5 opacity-70 hover:opacity-100">
            <X size={14} aria-hidden />
          </button>
        ) : null}
      </p>
      {onRetry ? (
        <button type="button" className={`${BTN_SECONDARY} mt-2 h-8 gap-1.5 px-3 text-sm`} disabled={retrying} aria-busy={retrying || undefined} onClick={onRetry}>
          {retrying ? <Loader2 size={13} aria-hidden className="animate-spin" /> : <RotateCw size={13} aria-hidden />}
          {retrying ? t("retrying") : t("retry")}
        </button>
      ) : null}
    </div>
  );
}
