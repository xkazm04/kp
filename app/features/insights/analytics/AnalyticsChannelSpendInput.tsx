"use client";

import { useTranslations } from "next-intl";
import { InlineNumberSave } from "./AnalyticsTab";

// E5 — inline spend editor: saves on blur/Enter, clears when emptied. The value
// re-syncs from the server after a save (the analytics reload), so the cost
// columns and the input always agree. Split out of AnalyticsChannelEconomicsPanel.tsx
// to keep that file under the 200-line cap.
export function SpendInput({
  channel,
  channelLabel,
  value,
  onSaved,
}: {
  channel: string;
  channelLabel: string;
  value: number | null;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics.channels");
  return (
    <InlineNumberSave
      value={value}
      width="w-24"
      inputClassName="text-sm"
      ariaLabel={t("spendAria", { channel: channelLabel })}
      failedTitle={t("spendSaveFailed")}
      onSave={async (amount) => {
        const r = await fetch("/api/analytics/spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, amountCzk: amount }),
        });
        if (!r.ok) throw new Error();
        onSaved();
      }}
    />
  );
}
