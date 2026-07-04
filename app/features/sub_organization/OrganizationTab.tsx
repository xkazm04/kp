"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Rocket } from "lucide-react";
import { isLocale } from "@/i18n/locales";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { readClientOrgName } from "@/app/_lib/org-settings";
import { OnboardingExperience } from "@/app/features/setup/OnboardingExperience";
import { OrganizationConsole } from "./OrganizationConsole";
import {
  MOCK_MEMBERS,
  nameFromEmail,
  type AppLanguage,
  type MemberRole,
  type OrgMember,
  type OrgProfile,
} from "./mock";

// Organization settings. The org NAME and app LANGUAGE are real, persisted
// settings that feed the JD builder and every LLM output op:
//   • name     → the kp_org_name cookie (setOrgName), debounced on edit.
//   • language → the app locale itself (setLocale + refresh) — org language IS
//                the app locale, so it flows through getServerLocale everywhere.
// Members (and the display domain/seats) remain mocked — no member store yet.
export function OrganizationTab() {
  const router = useRouter();
  const appLocale = useLocale();
  const [, startTransition] = useTransition();
  const [onboarding, setOnboarding] = useState(false);
  const [org, setOrg] = useState<OrgProfile>(() => ({
    name: readClientOrgName(),
    domain: "csas.cz",
    language: (isLocale(appLocale) ? appLocale : "en") as AppLanguage,
    seats: 25,
  }));
  const [members, setMembers] = useState<OrgMember[]>(MOCK_MEMBERS);
  const nextId = useRef(1);

  // Persist the org name (debounced) — it feeds the JD builder company default
  // and any LLM output that brands with the organization.
  useEffect(() => {
    const id = setTimeout(() => {
      void setOrgName(org.name);
    }, 500);
    return () => clearTimeout(id);
  }, [org.name]);

  const onOrgChange = (patch: Partial<OrgProfile>) => {
    setOrg((o) => ({ ...o, ...patch }));
    // App language is the org's language authority: persist it to BOTH the locale
    // cookie and the workspace default (setOrgLanguage), then re-render the app
    // under it — so recruiter UI, request-scoped generation, background automation
    // passes, and candidate comms all follow the one setting.
    if (patch.language && isLocale(patch.language)) {
      startTransition(async () => {
        await setOrgLanguage(patch.language as AppLanguage);
        router.refresh();
      });
    }
  };

  const onInvite = (email: string, role: MemberRole) =>
    setMembers((list) => [
      ...list,
      { id: `invite-${nextId.current++}`, name: nameFromEmail(email), email, role, status: "invited", lastActiveIso: null },
    ]);

  const onRoleChange = (id: string, role: MemberRole) =>
    setMembers((list) => list.map((m) => (m.id === id ? { ...m, role } : m)));

  const onRemove = (id: string) => setMembers((list) => list.filter((m) => m.id !== id));

  const view = { org, onOrgChange, members, onInvite, onRoleChange, onRemove };

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

      <OrganizationConsole {...view} />

      {onboarding ? <OnboardingExperience onClose={() => setOnboarding(false)} /> : null}
    </div>
  );
}
