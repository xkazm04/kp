"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { isTextPhrase, type Phrase } from "../../cohortTypes";
import { terseParam } from "./anatomyModel";

/**
 * A part's in-bar word, as short as stays true: a skill by its own name, a formula part by its
 * terse form (`layerAnatomy.terse`, e.g. "Level 9/23"), anything else as the whole phrase.
 */
export function useTerse(phrase: (p: Phrase) => string): (p: Phrase) => string {
  const t = useTranslations("analyzeCohort.layerAnatomy.terse");
  return useCallback(
    (p: Phrase) => {
      const skill = terseParam(p);
      if (skill) return skill;
      if (!isTextPhrase(p) && p.key.startsWith("part.")) {
        const key = p.key.slice("part.".length) as Parameters<typeof t>[0];
        if (t.has(key)) return t(key, p.params as Record<string, string | number> | undefined);
      }
      return phrase(p);
    },
    [t, phrase]
  );
}
