"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";

type OnboardingView = {
  role: string | null;
  candidateLabel: string | null;
  company: string | null;
  fields: { key: string; label: string }[];
  answers: Record<string, string>;
  submitted: boolean;
  progressPct: number;
};

// Pre-boarding questionnaire field → i18n label key. Driven by the server's `fields`
// list (the canonical ENTRY_QUESTIONNAIRE_FIELDS) so the two can't drift; an unknown
// field is skipped rather than rendered raw.
const FIELD_LABEL: Record<string, string> = {
  preferredName: "fieldPreferredName",
  tshirtSize: "fieldTshirtSize",
  dietaryNeeds: "fieldDietaryNeeds",
  equipmentPrefs: "fieldEquipmentPrefs",
  emergencyContact: "fieldEmergencyContact",
  startDateConfirm: "fieldStartDateConfirm",
};

// Public, token-gated onboarding hand-off (offers #5). The accepted offer's token lands
// the new hire here — a concrete next step (the pre-boarding questionnaire) replacing the
// old "our People team will be in touch" dead-end. The answers populate the candidate's
// onboarding run and surface on the recruiter's hand-off tab.
export function OnboardingClient() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const t = useTranslations("candidateOnboarding");
  const tCommon = useTranslations("common");
  const [view, setView] = useState<OnboardingView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // State is only written in the fetch's async callbacks (never synchronously
  // when the mount effect fires); every terminal branch settles BOTH failure
  // flags so a refetch (retry, locale switch) can't strand a stale one. The
  // retry button does its synchronous loading-state reset in its own handler.
  const load = useCallback(() => {
    if (!token) return;
    fetch(`/api/onboarding/candidate/${token}`)
      .then(async (r) => {
        const p = await r.json().catch(() => ({}));
        if (r.status === 404) {
          setNotFound(true);
          setLoadError(null);
          return;
        }
        if (!r.ok || p.error) {
          setLoadError(t("loadFailed"));
          setNotFound(false);
          return;
        }
        setLoadError(null);
        setNotFound(false);
        const v = p.onboarding as OnboardingView;
        setView(v);
        setAnswers(v.answers ?? {});
        setSaved(v.submitted);
      })
      .catch(() => {
        setLoadError(t("loadFailed"));
        setNotFound(false);
      });
  }, [token, t]);

  // "Retry": clear the error and show the loading state immediately (a
  // synchronous set is fine in an event handler), then refetch.
  const retryLoad = () => {
    setLoadError(null);
    setNotFound(false);
    load();
  };

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(`/api/onboarding/candidate/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!r.ok) throw new Error();
      setSaved(true);
    } catch {
      setSubmitError(t("submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  // Known default keys stay localized; a custom/preset field renders its authored label.
  const fieldLabel = (field: { key: string; label: string }) =>
    FIELD_LABEL[field.key] ? t(FIELD_LABEL[field.key] as Parameters<typeof t>[0]) : field.label;

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-stone-200 bg-white shadow-panel">
        <div className="h-1.5 bg-gradient-to-r from-moss via-moss to-coral" aria-hidden="true" />
        <div className="p-7">
          {notFound ? (
            <div className="rounded-lg bg-stone-100 p-4 text-center">
              <p className="text-base font-semibold text-ink">{t("invalidLink")}</p>
              <p className="mt-1 text-sm text-steel">{t("invalidLinkBody")}</p>
            </div>
          ) : loadError ? (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              <p>{loadError}</p>
              <button
                type="button"
                onClick={retryLoad}
                className="focus-ring mt-2 rounded-md border border-red-200 bg-white px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-100"
              >
                {tCommon("retry")}
              </button>
            </div>
          ) : !view ? (
            <p className="text-center text-sm text-steel">{tCommon("loading")}</p>
          ) : (
            <>
              <p className="text-meta uppercase tracking-wide text-moss">{t("eyebrow")}</p>
              <h1 className="mt-2 font-serif text-2xl text-ink">
                {view.candidateLabel ? t("welcomeName", { name: view.candidateLabel }) : t("welcome")}
              </h1>
              <p className="mt-1 text-base text-steel">
                {view.role
                  ? view.company
                    ? t("roleAt", { role: view.role, company: view.company })
                    : view.role
                  : t("roleGeneric")}
              </p>

              {saved ? (
                <div className="mt-6 rounded-lg bg-moss/10 p-4">
                  <p className="text-base font-semibold text-moss">{t("savedTitle")}</p>
                  <p className="mt-1 text-sm text-steel">{t("savedBody")}</p>
                  <button
                    type="button"
                    onClick={() => setSaved(false)}
                    className="focus-ring mt-3 text-sm font-semibold text-moss hover:underline"
                  >
                    {t("editAgain")}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mt-4 text-base leading-6 text-ink">{t("intro")}</p>
                  <div className="mt-5 space-y-3">
                    {view.fields.map((field) => (
                      <label key={field.key} className="block text-sm font-semibold text-steel">
                        {fieldLabel(field)}
                        <TextInput
                          type={field.key === "startDateConfirm" ? "date" : "text"}
                          value={answers[field.key] ?? ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [field.key]: e.target.value }))}
                          maxLength={500}
                          className="mt-1"
                        />
                      </label>
                    ))}
                  </div>
                  {submitError ? (
                    <p role="alert" className="mt-3 text-sm text-red-700">
                      {submitError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    aria-busy={submitting}
                    className="focus-ring mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-moss text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        {t("submitting")}
                      </>
                    ) : (
                      t("submit")
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
