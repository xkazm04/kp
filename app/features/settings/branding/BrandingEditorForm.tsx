"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL, PANEL } from "@/app/_components/ui/recipes";
// The placeholder shows the product's own default accent as the example hex.
import { CORAL } from "@/app/_lib/brand";

// Branding tab — the editor form (name/accent/logo fields + save/reset).
// Split out of BrandingTab.tsx.
export function BrandingEditorForm({
  name,
  onNameChange,
  accent,
  onAccentChange,
  effectiveAccent,
  accentWarning,
  logo,
  onLogoChange,
  dirty,
  saving,
  status,
  onSave,
  onReset,
  disabled = false,
}: {
  name: string;
  onNameChange: (v: string) => void;
  accent: string;
  onAccentChange: (v: string) => void;
  effectiveAccent: string;
  /** The localized reason this accent cannot be stored, or null. Not a boolean any
   *  more: an accent can fail in Studio Light (too pale for the cream canvas) or in
   *  Spark Dark (no legible twin that is still the operator's color), and the two
   *  ask for different fixes. */
  accentWarning: string | null;
  logo: string;
  onLogoChange: (v: string) => void;
  dirty: boolean;
  saving: boolean;
  status: { kind: "saved" | "error"; text: string } | null;
  onSave: () => void;
  onReset: () => void;
  /** True while GET /api/brand is still in flight. The form's frame, labels and
   *  help text are hardcoded, so they paint on the first frame; only the FIELDS
   *  wait — inert until the saved values land, so a keystroke typed into the gap
   *  can't be silently overwritten when the payload arrives. */
  disabled?: boolean;
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
          disabled={disabled}
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
            disabled={disabled}
            className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-stone-200 bg-white p-0.5"
          />
          <input
            type="text"
            value={accent}
            onChange={(e) => onAccentChange(e.target.value)}
            placeholder={CORAL}
            spellCheck={false}
            disabled={disabled}
            className={`${FIELD} w-32 nums`}
          />
          {accent.trim() ? (
            <button type="button" onClick={() => onAccentChange("")} className="text-sm text-steel underline hover:text-ink">
              {t("accentClear")}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-steel">{t("accentHelp")}</p>
        {accentWarning ? (
          <p role="alert" className="mt-1 text-sm text-coral">
            {accentWarning}
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
          disabled={disabled}
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
