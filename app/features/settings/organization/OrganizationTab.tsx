"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Rocket } from "lucide-react";
import { isLocale } from "@/i18n/locales";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { readClientOrgName } from "@/app/_lib/org-settings";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { OnboardingExperience } from "@/app/features/shell/setup/OnboardingExperience";
import { OrganizationGeneralPanel } from "./OrganizationGeneralPanel";
import type { AppLanguage } from "@/app/features/shared/memberUi";

// Organization settings — the COMPANY's identity, and nothing else. The org NAME
// and app LANGUAGE are real, persisted settings (name → the kp_org_name cookie;
// language → the app locale + workspace default).
//
// Member administration used to sit on this tab and moved to Settings → Workspaces
// (app/features/settings/workspace/WorkspaceTab.tsx). The reason is structural, not
// cosmetic: a role is stored per MEMBERSHIP, i.e. per workspace, and one person can
// hold several. An org-level roster could only ever render one of those seats
// (it read `m.teams[0]`), so it could neither show where somebody actually works
// nor put them on a second team. The workspaces console owns both lenses now.
export function OrganizationTab() {
  const router = useRouter();
  const t = useTranslations("workspaceAdmin.org");
  const appLocale = useLocale();
  const [, startTransition] = useTransition();
  const [onboarding, setOnboarding] = useState(false);
  const [name, setName] = useState<string>(() => readClientOrgName());
  const language: AppLanguage = (isLocale(appLocale) ? appLocale : "en") as AppLanguage;

  // Persist the org name (debounced) — feeds the JD builder company default and any
  // LLM output that brands with the organization. The write was fire-and-forget,
  // so the user had no way to know whether the name persisted; track it and let
  // the console render a Saving…/Saved/error ticker beside the field. The ref
  // skips the mount run (the initial value is already persisted).
  const [nameSave, setNameSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const nameHydrated = useRef(false);
  useEffect(() => {
    if (!nameHydrated.current) {
      nameHydrated.current = true;
      return;
    }
    const id = setTimeout(async () => {
      setNameSave("saving");
      try {
        await setOrgName(name);
        setNameSave("saved");
      } catch {
        setNameSave("error");
      }
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
    // Tier 1 (docs/design/loading-choreography.md): this tab has no fetch of its own
    // (name is cookie-hydrated, language is the app locale), so everything below is
    // chrome — the cascade just gives tab entry the same rhythm every other tab has,
    // and there is no aria-busy to own. The member roster, which WAS this tab's
    // first-load boundary, now lives in Settings -> Workspaces.
    <div className="stagger-children space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-stone-200 pb-5">
        <div>
          <p className={EYEBROW}>{t("eyebrow")}</p>
          <h1 className={`mt-1 ${TITLE_DISPLAY}`}>{t("title")}</h1>
          <p className={`mt-2 max-w-xl ${INTRO}`}>{t("intro")}</p>
        </div>
        <button
          type="button"
          onClick={() => setOnboarding(true)}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-coral/40 bg-coral/5 px-3 py-1.5 text-sm font-semibold text-coral transition-colors hover:bg-coral/10 dark:rounded-lg"
        >
          <Rocket size={14} aria-hidden /> {t("previewOnboarding")}
        </button>
      </header>

      {/* data-sim anchor: Getting-started "show me" coachmark target (org setup). */}
      <div data-sim="org-console" className="grid gap-6 lg:grid-cols-3">
        <OrganizationGeneralPanel
          name={name}
          nameSave={nameSave}
          domain="csas.cz"
          language={language}
          onNameChange={setName}
          onLanguageChange={onLanguageChange}
        />
      </div>

      {onboarding ? <OnboardingExperience mode="preview" onClose={() => setOnboarding(false)} /> : null}
    </div>
  );
}
