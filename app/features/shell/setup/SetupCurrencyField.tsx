"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { META_LABEL } from "@/app/_components/ui/recipes";
import { APP_CURRENCY } from "@/app/_lib/format";
import { readClientOrgCurrency } from "@/app/_lib/org-settings";
import { OrgCurrencyPicker } from "@/app/features/shared/OrgCurrencyPicker";
import { SETUP_PROSE } from "./setupProse";
import type { OnboardingCtrl } from "./setupSteps";

// Company step — the salary currency. Persisted by finish() through setOrgCurrency,
// the same write Settings → Organization makes.
//
// Seeded ONCE from the cookie, and only while the draft still holds the default,
// so a currency chosen earlier on this deployment (or restored from a draft) is
// never overwritten by a re-mount.
export function SetupCurrencyField({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup.company");
  const { update } = ctrl;
  const current = ctrl.state.currency;
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (current !== APP_CURRENCY) return;
    const stored = readClientOrgCurrency();
    if (stored !== current) update({ currency: stored });
  }, [current, update]);

  return (
    <div>
      <p id="setup-currency-label" className={`${META_LABEL} block`}>
        {t("currencyLabel")}
      </p>
      <OrgCurrencyPicker
        value={current}
        onChange={(currency) => update({ currency })}
        labelledBy="setup-currency-label"
        describedBy="setup-currency-hint"
        className="mt-1"
      />
      <p id="setup-currency-hint" className={`mt-1.5 text-sm text-steel ${SETUP_PROSE}`}>
        {t("currencyHint")}
      </p>
    </div>
  );
}
