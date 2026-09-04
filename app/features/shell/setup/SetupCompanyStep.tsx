"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import { accentIsLegible, deriveDarkAccent, normalizeHex6, sanitizeLogoUrl } from "@/app/_lib/brand-config";
import { CORAL, INK, MOSS, STEEL } from "@/app/_lib/brand";
import { SETUP_PROSE } from "./setupProse";
import type { OnboardingCtrl } from "./setupSteps";

// Company step — org name (required) and an OPTIONAL first brand touch (accent +
// logo, persisted via PUT /api/brand at finish). App language used to live here;
// it moved to the Welcome step, where it switches the app for real instead of
// sitting as a draft value until finish(). The accent
// swatches are stored brand VALUES (data fed to the brand config), not styling —
// they render via inline style the same way BrandingTab previews an arbitrary
// customer hex; the surrounding chrome stays fully tokenized.
// The three presets ARE the brand palette, so they read it from brand.ts rather
// than keeping a fourth copy of the same hexes — design:check pins those to
// globals.css, so a rebrand moves the swatches with the app.
const ACCENT_PRESETS = [
  { key: "default", hex: null },
  { key: "moss", hex: MOSS },
  { key: "steel", hex: STEEL },
  { key: "ink", hex: INK },
] as const;

export function CompanyStep({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.company");
  // WHICH theme the picked color fails in, or null. The wizard used to ask
  // `accentIsLegible(hex)` — the light grounds only — and then hand the value to a
  // door that now refuses an accent with no Spark Dark twin, so the wizard accepted
  // colors the save would reject and said nothing. Same rule as the Branding tab.
  const [customWarn, setCustomWarn] = useState<"light" | "dark" | null>(null);
  const logo = ctrl.state.logoUrl.trim();
  const logoInvalid = logo !== "" && sanitizeLogoUrl(logo) === null;
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === ctrl.state.accentColor);

  return (
    // No cap on the step: the FIELDS stay at a reading-comfortable max-w-md, the
    // descriptions run to the pane's prose width (setupProse.ts).
    <div className="space-y-5">
      <div className="max-w-md">
        <label htmlFor="setup-org-name" className={`${META_LABEL} block`}>
          {t("nameLabel")}
          <span aria-hidden className="text-coral">
            {" *"}
          </span>
        </label>
        <input
          id="setup-org-name"
          // No autoFocus: entering a step moves focus to its HEADING
          // (SetupWizardStepPane), which is what tells a screen-reader user the
          // screen changed. Two effects racing for focus on the same commit is a
          // coin flip, and the one that has to win is the announcement.
          aria-required
          value={ctrl.state.orgName}
          onChange={(e) => ctrl.update({ orgName: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && ctrl.canAdvance && ctrl.next()}
          placeholder={t("namePlaceholder")}
          className={`${FIELD} mt-1 w-full py-2.5 text-lg`}
        />
      </div>

      <fieldset>
        <legend className={`${META_LABEL} block`}>{t("brandLabel")}</legend>
        <p className={`mt-0.5 text-sm text-steel ${SETUP_PROSE}`}>{t("brandHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map(({ key, hex }) => {
            const active = ctrl.state.accentColor === hex;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setCustomWarn(null);
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
              value={normalizeHex6(ctrl.state.accentColor ?? "") ?? CORAL}
              onChange={(e) => {
                const hex = e.target.value;
                // Both themes: legible as typed in Studio Light, AND with a
                // derivable Spark Dark twin. Either failure blocks the pick.
                if (!accentIsLegible(hex, "light")) setCustomWarn("light");
                else if (deriveDarkAccent(hex) === null) setCustomWarn("dark");
                else {
                  setCustomWarn(null);
                  ctrl.update({ accentColor: hex });
                }
              }}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label={t("accent.custom")}
            />
          </label>
        </div>
        {customWarn ? (
          <p role="alert" className="mt-1.5 text-sm text-coral">
            {customWarn === "dark" ? t("accent.illegibleDark") : t("accent.illegible")}
          </p>
        ) : null}

        <div className="mt-3 max-w-md">
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
