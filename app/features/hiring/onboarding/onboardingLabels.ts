"use client";

import { useTranslations } from "next-intl";

// F16 — the read-time half of the onboarding template contract.
//
// A template row persists BOTH a stable id/key and a label (see the header of
// app/_lib/onboarding.ts). The id is the language-neutral reference; the label is
// only the fallback. Every recruiter-facing surface that renders a stored task or
// questionnaire field goes through here, so:
//
//   · a row from the shipped checklist or an industry preset reads in whichever
//     language the PERSON LOOKING AT IT chose — not the one whoever pressed
//     "Save template" happened to be running;
//   · a row the recruiter typed or edited has no catalog entry and renders exactly
//     what they wrote, never a raw "onboarding.task.foo" key path.
//
// One module rather than the same three-line `t.has` dance in four components: the
// questionnaire already had two copies of it that had drifted apart
// (docs/harness/code-refactor-2026-06-23/candidate-onboarding-hand-off.md #1).
//
// The candidate-facing page (app/onboarding/[token]) does the same resolution
// against its OWN namespace on purpose — a new hire reads "Confirm your start date",
// the recruiter reads "Confirmed start date" — so it keeps its own map.
export function useOnboardingLabels() {
  const t = useTranslations("onboarding");
  const resolve = (prefix: "task" | "field", id: string, fallback: string) => {
    const key = `${prefix}.${id}`;
    return t.has(key as Parameters<typeof t.has>[0]) ? t(key as Parameters<typeof t>[0]) : fallback;
  };
  return {
    /** Localized label for a stored checklist task, falling back to its own text. */
    taskLabel: (task: { id: string; label: string }) => resolve("task", task.id, task.label),
    /** Localized label for a stored questionnaire field, falling back to its own text. */
    fieldLabel: (field: { key: string; label: string }) => resolve("field", field.key, field.label),
  };
}
