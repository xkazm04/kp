"use client";

import { TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
import { ORG_CURRENCIES, type OrgCurrency } from "@/app/_lib/org-settings";

// The organization's salary currency as a segmented choice — ISO codes only, so the
// control reads the same in every locale. Shared by Settings → Organization and the
// first-run wizard's Company step, which write the same `kp_org_currency` setting.
export function OrgCurrencyPicker({
  value,
  onChange,
  labelledBy,
  describedBy,
  className = "",
}: {
  value: OrgCurrency;
  onChange: (next: OrgCurrency) => void;
  /** Id of the visible label naming the group. */
  labelledBy: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={`${TOGGLE_GROUP} flex-wrap ${className}`}
    >
      {ORG_CURRENCIES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={value === code}
          onClick={() => onChange(code)}
          className={`focus-ring nums rounded px-3 py-1.5 text-sm font-medium transition-colors ${toggleBtn(value === code)}`}
        >
          {code}
        </button>
      ))}
    </div>
  );
}
