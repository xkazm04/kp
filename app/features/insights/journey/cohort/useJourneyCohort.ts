"use client";

// The cohort layer's one read: GET /api/journeys/cohort, aborted on unmount, the failure
// resolved from the machine `code` (same contract as useJourneyBoard).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { JourneyCohort } from "@/app/_lib/journey/types";

export type JourneyCohortState = { cohort: JourneyCohort | null; loading: boolean; error: string | null };

type ApiErrorBody = { error?: string; code?: string };

export function useJourneyCohort(): JourneyCohortState {
  const t = useTranslations("journey.cohort");
  const errMsg = useErrorMessage();
  const [cohort, setCohort] = useState<JourneyCohort | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/journeys/cohort", { signal: controller.signal, headers: { accept: "application/json" } });
        const body: unknown = await res.json().catch(() => null);
        if (!live) return;
        if (!res.ok) {
          setError(errMsg(body as ApiErrorBody, t("loadError")));
          return;
        }
        setCohort(body as JourneyCohort);
      } catch (err) {
        if (!live || (err instanceof DOMException && err.name === "AbortError")) return;
        setError(t("loadError"));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [errMsg, t]);

  return { cohort, loading, error };
}
