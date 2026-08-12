"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { META_LABEL, PANEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { APP_LANGUAGES, type AppLanguage } from "@/app/features/shared/memberUi";

// Organization console — left panel: name/domain/language "General" settings.
// Split out of OrganizationConsole.tsx.
export function OrganizationGeneralPanel({
  name,
  nameSave = "idle",
  domain,
  language,
  onNameChange,
  onLanguageChange,
}: {
  name: string;
  /** Autosave state of the debounced org-name write, rendered beside the field. */
  nameSave?: "idle" | "saving" | "saved" | "error";
  domain: string;
  language: AppLanguage;
  onNameChange: (v: string) => void;
  onLanguageChange: (v: AppLanguage) => void;
}) {
  const t = useTranslations("workspaceAdmin.org");
  return (
    <div className={`${PANEL} h-fit p-5 lg:col-span-1`}>
      <h2 className="font-serif text-h3 text-ink">{t("general")}</h2>

      <label htmlFor="org-name-console" className={`${META_LABEL} mt-4 block`}>
        {t("nameLabel")}
      </label>
      <TextInput
        id="org-name-console"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={t("namePlaceholder")}
        className="mt-1"
      />
      {nameSave !== "idle" ? (
        <p role="status" aria-live="polite" className={`mt-1 text-sm ${nameSave === "error" ? "text-red-700" : "text-steel"}`}>
          {nameSave === "saving" ? t("saving") : nameSave === "saved" ? t("saved") : t("saveFailed")}
        </p>
      ) : null}

      <p className={`${META_LABEL} mt-4`}>{t("domainLabel")}</p>
      <p className="mt-1 flex items-center gap-1.5 text-body text-steel">
        <Lock size={13} aria-hidden /> {domain}
      </p>

      <p className={`${META_LABEL} mt-4`}>{t("languageLabel")}</p>
      {/* flex-wrap because this group holds full endonyms, not locale codes: at
          four languages ("English · Čeština · Deutsch · Français") the row is
          wider than this single-column panel and clipped "Français" at the card
          edge. The shared TOGGLE_GROUP stays nowrap for the code-based switchers. */}
      <div role="group" aria-label={t("languageLabel")} className={`${TOGGLE_GROUP} mt-1 flex-wrap`}>
        {APP_LANGUAGES.map((l) => {
          const isActive = language === l.value;
          return (
            <button
              key={l.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => onLanguageChange(l.value)}
              className={`focus-ring rounded px-3 py-1.5 text-sm font-medium transition-colors ${toggleBtn(isActive)}`}
            >
              {l.native}
            </button>
          );
        })}
      </div>
    </div>
  );
}
