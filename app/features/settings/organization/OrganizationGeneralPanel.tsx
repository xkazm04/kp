"use client";

import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { META_LABEL, PANEL, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { APP_LANGUAGES, type AppLanguage } from "@/app/features/shared/memberUi";
import { OrgCurrencyPicker } from "@/app/features/shared/OrgCurrencyPicker";
import type { OrgCurrency } from "@/app/_lib/org-settings";

type SaveState = "idle" | "saving" | "saved" | "error";

// Organization console — left panel: name/language/currency "General" settings.
// Split out of OrganizationConsole.tsx.
export function OrganizationGeneralPanel({
  name,
  nameSave = "idle",
  languageSave = "idle",
  currencySave = "idle",
  language,
  currency,
  onNameChange,
  onLanguageChange,
  onCurrencyChange,
}: {
  /** The salary currency and its write ticker (same shape as the language's). */
  currency: OrgCurrency;
  currencySave?: SaveState;
  onCurrencyChange: (v: OrgCurrency) => void;
  name: string;
  /** Autosave state of the debounced org-name write, rendered beside the field. */
  nameSave?: "idle" | "saving" | "saved" | "error";
  /** Same ticker for the language write, which is the more consequential of the
   *  two: it re-languages background automation and candidate comms for everyone,
   *  and it used to report nothing at all - the toggle simply moved. */
  languageSave?: "idle" | "saving" | "saved" | "error";
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
      {languageSave !== "idle" ? (
        <p role="status" aria-live="polite" className={`mt-1 text-sm ${languageSave === "error" ? "text-red-700" : "text-steel"}`}>
          {languageSave === "saving" ? t("saving") : languageSave === "saved" ? t("saved") : t("saveFailed")}
        </p>
      ) : null}

      <p id="org-currency-label" className={`${META_LABEL} mt-4`}>
        {t("currencyLabel")}
      </p>
      <OrgCurrencyPicker
        value={currency}
        onChange={onCurrencyChange}
        labelledBy="org-currency-label"
        describedBy="org-currency-hint"
        className="mt-1"
      />
      <p id="org-currency-hint" className="mt-1 text-sm text-steel">
        {t("currencyHint")}
      </p>
      {currencySave !== "idle" ? (
        <p role="status" aria-live="polite" className={`mt-1 text-sm ${currencySave === "error" ? "text-red-700" : "text-steel"}`}>
          {currencySave === "saving" ? t("saving") : currencySave === "saved" ? t("saved") : t("saveFailed")}
        </p>
      ) : null}
    </div>
  );
}
