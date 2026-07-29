"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedControl } from "@/app/_components/SegmentedControl";
import { TextInput } from "@/app/_components/TextInput";
import { APP_LANGUAGES, type AppLanguage } from "@/app/features/shared/memberUi";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { accentIsLegible, normalizeHex6, sanitizeLogoUrl } from "@/app/_lib/brand-config";
import type { OnboardingCtrl } from "./setupSteps";

// Company step — org name (required), app language, and an OPTIONAL first brand
// touch (accent + logo, persisted via PUT /api/brand at finish). The accent
// swatches are stored brand VALUES (data fed to the brand config), not styling —
// they render via inline style the same way BrandingTab previews an arbitrary
// customer hex; the surrounding chrome stays fully tokenized.
const ACCENT_PRESETS = [
  { key: "default", hex: null },
  { key: "moss", hex: "#526b4f" },
  { key: "steel", hex: "#42606f" },
  { key: "ink", hex: "#17202a" },
] as const;

export function CompanyStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.company");
  const [customWarn, setCustomWarn] = useState(false);
  const logo = ctrl.state.logoUrl.trim();
  const logoInvalid = logo !== "" && sanitizeLogoUrl(logo) === null;
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === ctrl.state.accentColor);

  return (
    <div className="max-w-md space-y-5">
      <div>
        <label htmlFor="setup-org-name" className={`${META_LABEL} block`}>
          {t("nameLabel")}
          <span aria-hidden className="text-coral">
            {" *"}
          </span>
        </label>
        <input
          id="setup-org-name"
          autoFocus
          aria-required
          value={ctrl.state.orgName}
          onChange={(e) => ctrl.update({ orgName: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && ctrl.canAdvance && ctrl.next()}
          placeholder={t("namePlaceholder")}
          className={`${FIELD} mt-1 w-full py-2.5 text-lg`}
        />
      </div>

      <div>
        <span className={`${META_LABEL} block`}>{t("languageLabel")}</span>
        <div className="mt-1">
          <SegmentedControl<AppLanguage>
            label={t("languageLabel")}
            value={ctrl.state.language}
            onChange={(language) => ctrl.update({ language })}
            options={APP_LANGUAGES.map((l) => ({ value: l.value, label: l.native }))}
          />
        </div>
      </div>

      <fieldset>
        <legend className={`${META_LABEL} block`}>{t("brandLabel")}</legend>
        <p className="mt-0.5 text-sm text-steel">{t("brandHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map(({ key, hex }) => {
            const active = ctrl.state.accentColor === hex;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setCustomWarn(false);
                  ctrl.update({ accentColor: hex });
                }}
                aria-pressed={active}
                aria-label={t(`accent.${key}`)}
                title={t(`accent.${key}`)}
                className={`focus-ring grid h-9 w-9 place-items-center rounded-full border-2 ${
                  active ? "border-ink" : "border-stone-300"
                } ${hex === null ? "bg-coral" : ""}`}
                style={hex === null ? undefined : { background: hex }}
              >
                {active ? <Check size={15} aria-hidden className="text-white" /> : null}
              </button>
            );
          })}
          <label
            className={`focus-ring relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 text-sm ${
              !isPreset && ctrl.state.accentColor ? "border-ink font-semibold text-ink" : "border-stone-300 text-steel"
            }`}
          >
            <span
              aria-hidden
              className="h-4 w-4 rounded-full border border-stone-300"
              style={{ background: normalizeHex6(ctrl.state.accentColor ?? "") ?? "var(--color-coral)" }}
            />
            {t("accent.custom")}
            <input
              type="color"
              value={normalizeHex6(ctrl.state.accentColor ?? "") ?? "#d65a4a"}
              onChange={(e) => {
                const hex = e.target.value;
                if (accentIsLegible(hex)) {
                  setCustomWarn(false);
                  ctrl.update({ accentColor: hex });
                } else {
                  setCustomWarn(true);
                }
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={t("accent.custom")}
            />
          </label>
        </div>
        {customWarn ? <p className="mt-1.5 text-sm text-coral">{t("accent.illegible")}</p> : null}

        <div className="mt-3">
          <label htmlFor="setup-logo-url" className={`${META_LABEL} block`}>
            {t("logoLabel")}
          </label>
          <TextInput
            id="setup-logo-url"
            value={ctrl.state.logoUrl}
            onChange={(e) => ctrl.update({ logoUrl: e.target.value })}
            placeholder="https://…"
            sizeVariant="sm"
            className="mt-1 w-full"
          />
          {logoInvalid ? <p className="mt-1 text-sm text-coral">{t("logoInvalid")}</p> : null}
        </div>
      </fieldset>
    </div>
  );
}
