"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorMessage, type ApiErrorPayload } from "@/app/_lib/use-error-message";
import { sendJson } from "../../data/useGigsData";

/** One sign-off write through a gigs route: busy while it runs, the error in the reader's
 *  language, the answer's body (or null when it failed). */
export function useWrite() {
  const t = useTranslations("gigs");
  const resolveError = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    const res = await sendJson(url, method, body);
    setBusy(false);
    if (!res.ok) {
      setError(resolveError(res.body as ApiErrorPayload | null, t("work.actionFailed")));
      return null;
    }
    return res.body ?? {};
  }
  return { busy, error, setError, run };
}
