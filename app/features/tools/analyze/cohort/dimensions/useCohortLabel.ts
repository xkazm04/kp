"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { AbsentReason, ShortLabel } from "../cohortTypes";

/**
 * A ShortLabel is DATA (cohortTypes): `key` names a message under `analyzeCohort.labels`, `params`
 * are its ICU values. This renders one in the reader's language; a key the catalog does not hold
 * renders nothing rather than the raw key (the fixture test pins that every engine key resolves).
 */
export function useCohortLabel(): (label: ShortLabel) => string {
  const t = useTranslations("analyzeCohort.labels");
  return useCallback(
    (label: ShortLabel) => {
      const key = label.key as Parameters<typeof t>[0];
      return t.has(key) ? t(key, label.params as Record<string, string | number> | undefined) : "";
    },
    [t]
  );
}

/** The reason an absent cell carries, in words (analyzeCohort.absent.*). */
export function useAbsentWord(): (reason: AbsentReason) => string {
  const t = useTranslations("analyzeCohort.absent");
  return useCallback((reason: AbsentReason) => t(reason), [t]);
}
