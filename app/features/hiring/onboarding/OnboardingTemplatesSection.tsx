"use client";

// The templates section of OnboardingTab: the template list + the new-template
// editor (dynamically imported by the caller). Split out of OnboardingTab.tsx
// to keep the tab file under the 200-line cap.

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import type { Template } from "./onboardingTabTypes";

export function OnboardingTemplatesSection({
  templates,
  loading,
  newOpen,
  onOpenNew,
  onCancelNew,
  onSavedNew,
  TemplateManager,
}: {
  templates: Template[];
  loading: boolean;
  newOpen: boolean;
  onOpenNew: () => void;
  onCancelNew: () => void;
  onSavedNew: (id: string) => void;
  TemplateManager: ComponentType<{ onCancel: () => void; onSaved: (id: string) => void }>;
}) {
  const t = useTranslations("onboarding");
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <p className="text-meta uppercase tracking-wide text-steel">{t("templatesTitle")}</p>
        {!newOpen ? (
          <button
            type="button"
            onClick={onOpenNew}
            className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border border-stone-200 px-2.5 text-sm font-semibold text-coral hover:bg-coral/5"
          >
            <Plus size={14} /> {t("newTemplate")}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-steel">{t("templatesNote")}</p>
      {newOpen ? <TemplateManager onCancel={onCancelNew} onSaved={onSavedNew} /> : null}
      {loading ? (
        // Tier 2: the templates list hasn't arrived yet — hold its height quietly.
        <div className="reveal-quiet mt-3 min-h-[6rem]" aria-hidden />
      ) : (
        <ul className="animate-arrive-in mt-3 space-y-2" role="list">
          {templates.map((tpl) => (
            <li key={tpl.id} className="rounded-md border border-stone-200 bg-white p-3">
              <p className="font-semibold text-ink">{tpl.name}</p>
              <p className="text-meta text-steel">{t("templateMeta", { tasks: tpl.tasks.length, questions: tpl.questionnaire.length })}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
