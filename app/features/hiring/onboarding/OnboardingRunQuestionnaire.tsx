"use client";

// The pre-boarding intake questionnaire section of the onboarding run detail
// view. Split out of OnboardingRunDetailView.tsx to keep that file under the
// 200-line cap.

import type { MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import type { QuestionnaireField } from "@/app/_lib/onboarding";
import { useOnboardingLabels } from "./onboardingLabels";

export function OnboardingRunQuestionnaire({
  questionnaire,
  answers,
  setAnswers,
  savedAnswersRef,
  onFieldSaved,
}: {
  questionnaire: QuestionnaireField[];
  answers: Record<string, string>;
  setAnswers: (updater: (a: Record<string, string>) => Record<string, string>) => void;
  savedAnswersRef: MutableRefObject<Record<string, string>>;
  onFieldSaved: (key: string, value: string) => void;
}) {
  const t = useTranslations("onboarding");
  // F16 — was a six-entry literal built by the parent, so the eight preset-specific
  // fields (license number, PPE size, work authorization, …) fell through to their
  // stored English label. Resolved here against the whole `onboarding.field.*` set.
  const { fieldLabel } = useOnboardingLabels();
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <p className="text-meta uppercase tracking-wide text-steel">{t("questionnaire")}</p>
      <p className="mt-1 text-sm text-steel">{t("questionnaireNote")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {questionnaire.map((field) => (
          <label key={field.key} className="block">
            <span className="text-meta text-steel">{fieldLabel(field)}</span>
            <TextInput
              type="text"
              value={answers[field.key] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [field.key]: e.target.value }))}
              onBlur={() => {
                // Only persist when THIS field changed since the last save; send
                // just the changed key (the store merges it into the stored row).
                const current = answers[field.key] ?? "";
                if ((savedAnswersRef.current[field.key] ?? "") === current) return;
                savedAnswersRef.current = { ...savedAnswersRef.current, [field.key]: current };
                onFieldSaved(field.key, current);
              }}
              sizeVariant="sm"
              className="mt-1"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
