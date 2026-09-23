"use client";

// The exact offer letter at the approval gate, in the candidate's language, with its
// delivery forecast (comms-letter-preview.ts; docs/features/comms/README.md §8).
import { useEffect, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CHIP_QUIET, META_LABEL, NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { OfferLetterForecast, OfferLetterPreview as OfferLetterPreviewData } from "@/app/_lib/comms-letter-preview";

// Debounced (typing "14" never renders "1"), stale requests aborted, idle while closed.
// Inlined here: app/page.tsx's module count sits at its perf-budget ceiling.
const DEBOUNCE_MS = 300;

type OfferLetterPreviewState = {
  preview: OfferLetterPreviewData | null;
  error: ApiErrorPayload | null;
  loading: boolean;
};

function useOfferLetterPreview(entryId: string, ttlDays: number, enabled: boolean): OfferLetterPreviewState {
  const [state, setState] = useState<OfferLetterPreviewState>({ preview: null, error: null, loading: false });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      fetch(`/api/pipeline/${encodeURIComponent(entryId)}/offer-letter?ttlDays=${encodeURIComponent(String(ttlDays))}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as (OfferLetterPreviewData & ApiErrorPayload) | null;
          if (controller.signal.aborted) return;
          if (!res.ok || !body) setState({ preview: null, error: body ?? {}, loading: false });
          else setState({ preview: body, error: null, loading: false });
        })
        .catch(() => {
          // An abort is a superseded request, not a failure; a network error is.
          if (!controller.signal.aborted) setState({ preview: null, error: {}, loading: false });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [entryId, ttlDays, enabled]);

  return state;
}

function languageName(appLocale: string, letterLocale: string): string {
  try {
    return new Intl.DisplayNames([appLocale], { type: "language" }).of(letterLocale) ?? letterLocale;
  } catch {
    /* an engine without DisplayNames data still shows the code */
    return letterLocale;
  }
}

export function OfferLetterPreview({ entryId, ttlDays }: { entryId: string; ttlDays: number }) {
  const t = useTranslations("decisions.aiReview");
  const appLocale = useLocale();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const { preview, error, loading } = useOfferLetterPreview(entryId, ttlDays, open);
  const paneId = `offer-letter-${entryId}`;

  const forecastLine = (forecast: OfferLetterForecast, reason: string | null): { text: string; tone: "ok" | "warn" | "stop" } => {
    switch (forecast) {
      case "relay":
        return reason === "no_contact" ? { text: t("letterForecastRelayNoContact"), tone: "warn" } : { text: t("letterForecastRelay"), tone: "ok" };
      case "local":
        return { text: t("letterForecastLocal"), tone: "warn" };
      case "simulation":
        return { text: t("letterForecastSimulation"), tone: "warn" };
      case "refused":
        return { text: t("letterForecastRefused"), tone: "stop" };
      case "suppressed":
        return { text: t("letterForecastSuppressed", { reason: reason ?? "other" }), tone: "stop" };
    }
  };

  return (
    <div className="mt-2 border-t border-stone-200 pt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={paneId}
        onClick={() => setOpen((v) => !v)}
        className="focus-ring inline-flex cursor-pointer items-center gap-1 rounded-md text-sm font-semibold text-ink hover:text-coral"
      >
        <Mail size={14} aria-hidden /> {t("letterToggle")}
        <ChevronDown size={14} aria-hidden className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open ? (
        <div id={paneId} className="mt-2 space-y-2" aria-busy={loading}>
          {error ? (
            <p role="alert" className={`${NOTICE("critical")} px-2 py-1.5 text-sm`}>
              {errorMessage(error, t("letterFailed"))}
            </p>
          ) : !preview ? (
            <p className="text-sm text-steel" role="status">
              {t("letterLoading")}
            </p>
          ) : (
            (() => {
              const line = forecastLine(preview.forecast, preview.forecastReason);
              return (
                <>
                  <p
                    role="status"
                    className={
                      line.tone === "ok"
                        ? "text-sm text-moss"
                        : `${NOTICE(line.tone === "stop" ? "critical" : "amber")} px-2 py-1.5 text-sm`
                    }
                  >
                    {line.text}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-steel">
                    <span className={META_LABEL}>{t("letterHeading")}</span>
                    <span className={CHIP_QUIET}>{t("letterLanguage", { language: languageName(appLocale, preview.locale) })}</span>
                    <span>{preview.recipient ? t("letterTo", { recipient: preview.recipient }) : t("letterNoRecipient")}</span>
                  </div>
                  <div className={`rounded-md border border-stone-200 bg-white p-2.5 ${loading ? "opacity-60" : ""}`} lang={preview.locale}>
                    <p className="text-sm font-semibold text-ink">{t("letterSubject", { subject: preview.subject })}</p>
                    <p className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm text-ink">{preview.body}</p>
                  </div>
                  <p className="text-meta text-steel">{t("letterPlaceholderNote")}</p>
                </>
              );
            })()
          )}
        </div>
      ) : null}
    </div>
  );
}
