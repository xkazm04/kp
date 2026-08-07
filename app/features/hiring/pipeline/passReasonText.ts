"use client";

import { useTranslations } from "next-intl";

/*
 * Render an automation-pass decision's wrapper sentence in the reader's language.
 *
 * `automation-pass.ts` composes four wrapper sentences around a policy decision
 * ("Skipped: stage changed mid-pass. Original policy decision: …"). The English
 * text stays on the decision because it is **sealed into the run record** — an
 * exporter, an auditor and `deriveDecisionOutcome`'s legacy prefix parser all
 * read it. What the UI renders is the structured mirror the pass now also emits
 * (`reasonCode` + `reasonParams`).
 *
 * Exactly the split DecisionsScreenWaveLists already uses for the screening
 * wave, and for the same reason: a record and a screen are two different
 * readers. A row written before codes existed carries no `reasonCode`, so it
 * falls back to its persisted English rather than losing the reason entirely.
 */
export interface PassReasonBearing {
  /** The sealed English sentence. Optional because a persisted run row may omit it. */
  reason?: string;
  reasonCode?: string | null;
  reasonParams?: Record<string, string | number> | null;
}

export function usePassReasonText(): (d: PassReasonBearing) => string {
  const t = useTranslations("decisions.pass");
  return (d) => {
    if (!d.reasonCode) return d.reason ?? "";
    const key = `reasons.${d.reasonCode}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key, (d.reasonParams ?? {}) as Record<string, string | number>) : d.reason ?? "";
  };
}
