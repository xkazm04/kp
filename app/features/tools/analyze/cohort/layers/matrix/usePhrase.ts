"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { isTextPhrase, type Phrase } from "../../cohortTypes";

/**
 * A why phrase in the reader's language: analysis prose (`{ text }`) renders verbatim, in the
 * report's language; a code-made word (`{ key, params }`) is a message under analyzeCohort.why.
 * A key the catalog does not hold renders nothing rather than the raw key (cohortFixture.test.ts
 * pins that every engine key resolves).
 */
export function usePhrase(): (p: Phrase) => string {
  const t = useTranslations("analyzeCohort.why");
  return useCallback(
    (p: Phrase) => {
      if (isTextPhrase(p)) return p.text;
      const key = p.key as Parameters<typeof t>[0];
      return t.has(key) ? t(key, p.params as Record<string, string | number> | undefined) : "";
    },
    [t]
  );
}
