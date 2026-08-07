"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { RubricStrings } from "@/app/_lib/interview-rubric";

// The recruiter-side seam for the `rubric` catalog namespace (competency labels,
// descriptions, BARS anchors, the 1–5 scale).
//
// UI-USER SIDE, deliberately: a rubric is read by whoever has the scorecard open,
// so it follows the REQUEST's locale — unlike the interview-prep pack or a
// published posting, whose language is a property of the artifact and which use
// the locale-pinned translator in catalog-translator.ts instead.
//
// Returns the has-fallback lookup interview-rubric.ts's pure functions take, so a
// competency with no catalog entry (an LLM-emitted axis outside the fixed rubric)
// degrades to its canonical English rather than rendering the raw key.
export function useRubricStrings(): RubricStrings {
  const t = useTranslations("rubric");
  return useMemo<RubricStrings>(
    () => (key) => {
      const k = key as Parameters<typeof t>[0];
      return t.has(k) ? t(k) : undefined;
    },
    [t]
  );
}
