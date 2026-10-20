"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { Gig, GigBrief } from "@/app/_lib/gigs/types";
import { sendJson } from "../../data/useGigsData";
import type { AfterWrite } from "../../logic/wire";

/** Research (or research again) one gig: POST /api/gigs/[id]/research. The brief it answers
 *  is shown in place until the list re-read carries it. Shared by the Brief tab, the
 *  report's plans section ("Research the gig first") and the Review tab's message card. */
export function useResearch(gig: Gig, onChanged: AfterWrite) {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ gigId: string; brief: GigBrief } | null>(null);
  const brief = fresh && fresh.gigId === gig.id && (!gig.brief || gig.brief.createdAt < fresh.brief.createdAt) ? fresh.brief : gig.brief;

  async function research() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/gigs/${encodeURIComponent(gig.id)}/research`, "POST", {});
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("brief.failed")));
      return;
    }
    const next = (res.body?.gig as Gig | undefined)?.brief ?? null;
    if (next) setFresh({ gigId: gig.id, brief: next });
    await onChanged(null);
  }

  return { brief, busy, error, research };
}
