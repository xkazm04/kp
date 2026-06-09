"use client";

import { useTranslations } from "next-intl";
import { labelize } from "@/app/_lib/format";

// Localized display label for a canonical enum/slug value. The wire value stays
// canonical English (the pipeline branches on it — stages, advance|hold|reject,
// archetype ids, role families); only the DISPLAYED label is localized. Returns
// the translation for `enums.<group>.<slug>` when present, else falls back to
// `labelize(slug)` (the prior English Title-Case behaviour) — so a slug without a
// catalog entry yet degrades gracefully instead of throwing on a missing key.
// This is the recruiter-side replacement for scattered `labelize(...)` calls.
export function useEnumLabel(): (group: string, slug: string | null | undefined) => string {
  const t = useTranslations("enums");
  return (group, slug) => {
    const s = (slug ?? "").trim();
    if (!s) return "";
    const key = `${group}.${s}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(s);
  };
}
