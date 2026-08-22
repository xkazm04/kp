"use client";

import { useCallback } from "react";
import { useLocale } from "next-intl";
import { formatRelativeTime } from "@/app/_lib/format";

/**
 * The active-locale binding of {@link formatRelativeTime} for client components:
 * `const rel = useRelativeTime(); … rel(row.createdAt)`. Every dense "x ago"
 * surface (control room audit/outcomes, decision log, outbox, tasks, analysis
 * history, dev cases) renders through this, so a table with a localized header
 * can never sit above an English "23d ago".
 *
 * Locale-aware pluralization/word-order lives in `Intl.RelativeTimeFormat`
 * inside formatRelativeTime — this hook only threads next-intl's active locale
 * into it. Server components skip the hook and pass `await getLocale()` to
 * formatRelativeTime directly.
 *
 * Memoized on the locale — the same stable-identity contract as
 * {@link useNumberFormat} and useErrorMessage, so the formatter is safe to name
 * in a dependency array.
 */
export function useRelativeTime(): (iso: string | null | undefined) => string {
  const locale = useLocale();
  return useCallback((iso: string | null | undefined) => (iso ? formatRelativeTime(iso, locale) : ""), [locale]);
}
