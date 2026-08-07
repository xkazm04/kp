"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Rocket } from "lucide-react";
import { isLocale } from "@/i18n/locales";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { readClientOrgName } from "@/app/_lib/org-settings";
import { OnboardingExperience } from "@/app/features/setup/OnboardingExperience";
import { OrganizationConsole } from "./OrganizationConsole";
import type { AppLanguage } from "./member-ui";

// Organization settings. The org NAME and app LANGUAGE are real, persisted settings
// (name → the kp_org_name cookie; language → the app locale + workspace default).
// Members are now real too — the console reads /api/org/* (was the mock roster).
export function OrganizationTab() {
  const router = useRouter();
  const appLocale = useLocale();
  const [, startTransition] = useTransition();
  const [onboarding, setOnboarding] = useState(false);
  const [name, setName] = useState<string>(() => readClientOrgName());
  const language: AppLanguage = (isLocale(appLocale) ? appLocale : "en") as AppLanguage;

  // Persist the org name (debounced) — feeds the JD builder company default and any
  // LLM output that brands with the organization.
  useEffect(() => {
    const id = setTimeout(() => {
      void setOrgName(name);
    }, 500);
    return () => clearTimeout(id);
  }, [name]);

  // App language is the org's language authority: persist to BOTH the locale cookie
  // and the workspace default, then re-render the app under it — so recruiter UI,
  // request-scoped generation, background automation, and candidate comms all follow.
  function onLanguageChange(next: AppLanguage) {
    if (!isLocale(next) || next === language) return;
    startTransition(async () => {
      await setOrgLanguage(next);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOnboarding(true)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 py-1.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10 dark:rounded-lg"
        >
          <Rocket size={14} aria-hidden /> Preview onboarding flow
        </button>
      </div>

      <OrganizationConsole name={name} domain="csas.cz" language={language} onNameChange={setName} onLanguageChange={onLanguageChange} />

      {onboarding ? <OnboardingExperience onClose={() => setOnboarding(false)} /> : null}
    </div>
  );
}
