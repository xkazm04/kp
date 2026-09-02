"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Rocket } from "lucide-react";
import { isLocale } from "@/i18n/locales";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { readClientOrgName } from "@/app/_lib/org-settings";
import { Defer } from "@/app/_components/ui/Defer";
import { EYEBROW, INTRO, TITLE_DISPLAY } from "@/app/_components/ui/recipes";
import { OnboardingExperience } from "@/app/features/shell/setup/OnboardingExperience";
import { OrganizationGeneralPanel } from "./OrganizationGeneralPanel";
import type { AppLanguage } from "@/app/features/shared/memberUi";

// Tier 3 (docs/design/loading-choreography.md): backup/restore is the tab's
// secondary surface — nobody opens Organization to take a database dump first —
// so it gets its own chunk and mounts an idle beat after the console.
const OrganizationBackupPanel = dynamic(
  () => import("./OrganizationBackupPanel").then((m) => ({ default: m.OrganizationBackupPanel })),
  { loading: () => <div className="reveal-quiet min-h-[12rem]" aria-hidden /> }
);

// Organization settings — the COMPANY's identity, and nothing else. The org NAME
// and app LANGUAGE are real, persisted settings (name → the kp_org_name cookie;
// language → the app locale + workspace default). Backup & restore lives here too:
// a whole-database dump/restore is org-level administration, not a task readout.
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
  const errMsg = useErrorMessage();
  const [, startTransition] = useTransition();
  // The language write's ticker, the twin of nameSave below. `isPending` from the
  // transition was deliberately NOT used for it: the transition covers the action
  // AND the router.refresh() that follows, so it would keep claiming "saving" long
  // after the write landed - and it can say nothing at all about a refusal.
  const [languageSave, setLanguageSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [onboarding, setOnboarding] = useState(false);
  const [name, setName] = useState<string>(() => readClientOrgName());
  const language: AppLanguage = (isLocale(appLocale) ? appLocale : "en") as AppLanguage;

  // Persist the org name (debounced) — feeds the JD builder company default and any
  // LLM output that brands with the organization. The write was fire-and-forget,
  // so the user had no way to know whether the name persisted; track it and let
  // the console render a Saving…/Saved/error ticker beside the field. The ref
  // skips the mount run (the initial value is already persisted).
  const [nameSave, setNameSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Every keystroke retires the previous verdict (editName below). The ticker used
  // to keep reading "Saved" for the whole 500ms debounce window — over text that was
  // NOT saved — so appending to an already-saved name and leaving the tab inside
  // that window discarded the edit under a standing green claim. No claim is the
  // honest state while a write is still pending.
  const editName = (v: string) => {
    setName(v);
    setNameSave("idle");
  };
  const nameHydrated = useRef(false);
  useEffect(() => {
    if (!nameHydrated.current) {
      nameHydrated.current = true;
      return;
    }
    const id = setTimeout(async () => {
      setNameSave("saving");
      try {
        // The action now ANSWERS: a caller without org:manage is refused, and a
        // refusal that still ticked over to "Saved" would be the green lie the
        // house rules name explicitly.
        const res = await setOrgName(name);
        setNameSave(res.ok ? "saved" : "error");
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
    setLanguageSave("saving");
    startTransition(async () => {
      const res = await setOrgLanguage(next);
      if (!res.ok) {
        setLanguageSave("error");
        // Refusing and then refreshing anyway would repaint the OLD language with no
        // explanation - the toggle would simply spring back. Say why instead, from
        // the code, in the reader's language.
        toast.error(errMsg({ code: res.code }, t("saveFailed")));
        return;
      }
      setLanguageSave("saved");
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
          {/* No max-width clamp: this subtitle is one short sentence pair and
              should read as one line. `max-w-xl` broke it across two even on a
              wide screen, which made a 12-word lede look like a paragraph. */}
          <p className={`mt-2 ${INTRO}`}>{t("intro")}</p>
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
          languageSave={languageSave}
          language={language}
          onNameChange={editName}
          onLanguageChange={onLanguageChange}
        />
      </div>

      <Defer strategy="idle">
        <OrganizationBackupPanel />
      </Defer>

      {onboarding ? <OnboardingExperience mode="preview" onClose={() => setOnboarding(false)} /> : null}
    </div>
  );
}
