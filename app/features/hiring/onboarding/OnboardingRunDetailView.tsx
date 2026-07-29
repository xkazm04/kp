"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { OnboardingRunChecklist } from "./OnboardingRunChecklist";
import { OnboardingRunQuestionnaire } from "./OnboardingRunQuestionnaire";
import { OnboardingRunSignatures } from "./OnboardingRunSignatures";
import type { RunDetail } from "./onboardingRunDetailTypes";

// Tier 3 (docs/LOADING_CHOREOGRAPHY.md): the run detail is a full secondary
// "page" reached only by clicking a run — it lives in its own chunk (see the
// next/dynamic import in OnboardingTab.tsx) so selecting a candidate's
// onboarding run doesn't cost the list view anything upfront.

export function RunDetailView({ runId, onBack }: { runId: string; onBack: () => void }) {
  const t = useTranslations("onboarding");
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // The intake snapshot as last persisted by the server, so a field blur only
  // PATCHes the key that actually changed (candidate-onboarding-hand-off #1). An
  // unconditional blur PATCH re-stamps submitted_at and, before the store learned
  // to merge, could overwrite the candidate's answers with a stale form snapshot.
  const savedAnswersRef = useRef<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Load the run detail on mount / when the selected run changes — inline IIFE so
  // setState lands after the await (the allowed effect shape). patch() refreshes
  // detail directly thereafter, so no separate reusable loader is needed.
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/onboarding/${encodeURIComponent(runId)}`);
      if (!live) return;
      // A non-OK response is an { error, code } envelope, not a RunDetail — storing it
      // as `detail` blanked/crashed the whole tab (detail.run / detail.tasks.map). Keep
      // detail null and surface the failure instead.
      if (!r.ok) {
        setError(t("saveFailed"));
        return;
      }
      const p = (await r.json()) as RunDetail;
      setDetail(p);
      setAnswers(p.intake ?? {});
      savedAnswersRef.current = p.intake ?? {};
      setError(null);
    })();
    return () => {
      live = false;
    };
  }, [runId, t]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/onboarding/${encodeURIComponent(runId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // Never overwrite the loaded detail with a non-OK { error } envelope — that
    // crashed the tab on the next render. Keep the current state and flag the failure.
    if (!r.ok) {
      setError(t("saveFailed"));
      return;
    }
    setDetail((await r.json()) as RunDetail);
    setError(null);
  };

  const doneIds = detail ? new Set(detail.states.filter((s) => s.done).map((s) => s.taskId)) : new Set<string>();
  // next-intl rejects template-literal keys → resolve field labels via a literal map.
  const fieldLabels: Record<string, string> = {
    preferredName: t("field.preferredName"),
    tshirtSize: t("field.tshirtSize"),
    dietaryNeeds: t("field.dietaryNeeds"),
    equipmentPrefs: t("field.equipmentPrefs"),
    emergencyContact: t("field.emergencyContact"),
    startDateConfirm: t("field.startDateConfirm"),
  };

  return (
    // Tier 1: the back button is chrome — it depends on nothing and must render
    // on the first frame. The fetched run (name, checklist, questionnaire,
    // signatures) is one Tier-2 region: a single fetch, so one placeholder / one
    // arrive-in swap, same shape as ModelsTab's routing table.
    <div className="mx-auto max-w-3xl stagger-children space-y-6" aria-busy={!detail && !error}>
      <button type="button" onClick={onBack} className="focus-ring text-sm font-semibold text-coral hover:underline">
        ← {t("back")}
      </button>

      {!detail ? (
        error ? (
          <p className="text-base text-coral" role="alert">{error}</p>
        ) : (
          <div className="reveal-quiet min-h-[28rem]" aria-hidden />
        )
      ) : (
        <div className="animate-arrive-in space-y-6">
          <div>
            <h1 className="font-serif text-h1 text-ink">{detail.run.candidateLabel ?? t("aCandidate")}</h1>
            {detail.run.jobTitle ? <p className="mt-0.5 text-base text-steel">{detail.run.jobTitle}</p> : null}
          </div>

          {error ? (
            <p className="rounded-md bg-coral/10 px-3 py-2 text-sm font-medium text-coral" role="alert">
              {error}
            </p>
          ) : null}

          <OnboardingRunChecklist
            tasks={detail.tasks}
            doneIds={doneIds}
            progress={detail.progress}
            onToggle={(taskId, done) => void patch({ action: "task", taskId, done })}
          />

          <OnboardingRunQuestionnaire
            questionnaire={detail.questionnaire}
            answers={answers}
            setAnswers={setAnswers}
            savedAnswersRef={savedAnswersRef}
            fieldLabels={fieldLabels}
            onFieldSaved={(key, value) => void patch({ action: "intake", answers: { [key]: value } })}
          />

          <OnboardingRunSignatures
            signatures={detail.signatures}
            candidateLabel={detail.run.candidateLabel}
            onSign={(signatureId, signer) => void patch({ action: "sign", signatureId, signer })}
            onRequestSign={(document) => void patch({ action: "request_sign", document })}
          />
        </div>
      )}
    </div>
  );
}
