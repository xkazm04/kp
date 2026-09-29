"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigAttempt, GigOutcome } from "@/app/_lib/gigs/types";

export type GigRecord = { gig: Gig; attempts: GigAttempt[]; outcomes: GigOutcome[] };

/** Every attempt and every verdict of one gig, read fresh from GET /api/gigs/[id] (the list
 *  carries only the latest attempt). Re-read when the gig moves. */
export function useGigRecord(gig: Gig | null): { record: GigRecord | null; error: string | null } {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [state, setState] = useState<{ id: string; record: GigRecord | null; error: string | null } | null>(null);
  const id = gig?.id ?? null;
  const updatedAt = gig?.updatedAt ?? null;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetch(`/api/gigs/${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as (GigRecord & ApiErrorPayload) | null;
        if (!alive) return;
        if (!r.ok || !body) setState({ id, record: null, error: resolveError(body, t("detail.recordFailed")) });
        else setState({ id, record: body, error: null });
      })
      .catch(() => {
        // Unreachable server: the generic sentence is all there is to say.
        if (alive) setState({ id, record: null, error: t("detail.recordFailed") });
      });
    return () => {
      alive = false;
    };
  }, [id, updatedAt, resolveError, t]);
  return state && state.id === id ? { record: state.record, error: state.error } : { record: null, error: null };
}
