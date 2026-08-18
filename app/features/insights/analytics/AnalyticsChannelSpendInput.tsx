"use client";

import { useTranslations } from "next-intl";
// Straight to the primitive, not through the AnalyticsTab barrel: the Economics board
// now imports this module, and the barrel would drag the whole tab component into the
// Economics chunk to reach one input (UAT KAT-ANA-2).
import { InlineNumberSave } from "./AnalyticsInlineNumberSave";

// E5 — inline spend editor: saves on blur/Enter, clears when emptied. The value
// re-syncs from the server after a save (the analytics reload), so the cost
// columns and the input always agree. Split out of AnalyticsChannelEconomicsPanel.tsx
// to keep that file under the 200-line cap.
//
// UAT KAT-ANA-2 — this is the ONLY write path to `channel_spend` in the product: the
// sole caller of POST /api/analytics/spend, whose setChannelSpend is the sole writer of
// the table, which no seeder touches either. It was unreachable for the whole life of
// the section consolidation (its host panel stopped being imported), while the figure
// it feeds went on rendering. Anything that stops rendering this component takes
// cost-per-hire down with it — check the Economics board before moving it.
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
