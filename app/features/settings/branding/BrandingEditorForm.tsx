"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";

// Branding tab — the editor form (name/accent/logo fields + save/reset).
// Split out of BrandingTab.tsx.
export function BrandingEditorForm({
  name,
  onNameChange,
  accent,
  onAccentChange,
  effectiveAccent,
  accentIllegible,
  logo,
  onLogoChange,
  dirty,
  saving,
  status,
  onSave,
  onReset,
}: {
  name: string;
  onNameChange: (v: string) => void;
  accent: string;
  onAccentChange: (v: string) => void;
  effectiveAccent: string;
  accentIllegible: boolean;
  logo: string;
  onLogoChange: (v: string) => void;
  dirty: boolean;
  saving: boolean;
  status: { kind: "saved" | "error"; text: string } | null;
  onSave: () => void;
  onReset: () => void;
}) {
  const t = useTranslations("branding");

  return (
    <div className={`${PANEL} space-y-5 p-5`}>
      <div>
        <label htmlFor="brand-name" className={META_LABEL}>
          {t("nameLabel")}
        </label>
        <input
          id="brand-name"
          type="text"
          value={name}
          maxLength={60}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("namePlaceholder")}
          className={`${FIELD} mt-1 w-full`}
        />
        <p className="mt-1 text-sm text-steel">{t("nameHelp")}</p>
      </div>

      <div>
        <label htmlFor="brand-accent" className={META_LABEL}>
          {t("accentLabel")}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="brand-accent"
            type="color"
            value={effectiveAccent}
            onChange={(e) => onAccentChange(e.target.value)}
            aria-label={t("accentLabel")}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-stone-200 bg-white p-0.5"
          />
          <input
            type="text"
            value={accent}
            onChange={(e) => onAccentChange(e.target.value)}
            placeholder="#d65a4a"
            spellCheck={false}
            className={`${FIELD} w-32 nums`}
          />
          {accent.trim() ? (
            <button type="button" onClick={() => onAccentChange("")} className="text-sm text-steel underline hover:text-ink">
              {t("accentClear")}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-steel">{t("accentHelp")}</p>
        {accentIllegible ? (
          <p role="alert" className="mt-1 text-sm text-coral">
            {t("accentContrast")}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="brand-logo" className={META_LABEL}>
          {t("logoLabel")}
        </label>
        <input
          id="brand-logo"
          type="url"
          value={logo}
          onChange={(e) => onLogoChange(e.target.value)}
          placeholder="https://…/logo.png"
          spellCheck={false}
          className={`${FIELD} mt-1 w-full`}
        />
        <p className="mt-1 text-sm text-steel">{t("logoHelp")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
        <button type="button" onClick={onSave} disabled={saving || !dirty} className={`${BTN_PRIMARY} h-9 px-4 text-sm`}>
          {saving ? t("saving") : t("save")}
        </button>
        <button type="button" onClick={onReset} disabled={saving || !dirty} className={`${BTN_SECONDARY} h-9 px-3 text-sm`}>
          <RotateCcw size={14} aria-hidden /> {t("reset")}
        </button>
        {status ? (
          <span
            role={status.kind === "error" ? "alert" : "status"}
            className={`inline-flex items-center gap-1.5 text-sm ${status.kind === "error" ? "text-coral" : "text-moss"}`}
          >
            {status.kind === "saved" ? <CheckCircle2 size={15} aria-hidden /> : null}
            {status.text}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-steel">{t("appliesNote")}</p>
    </div>
  );
}
