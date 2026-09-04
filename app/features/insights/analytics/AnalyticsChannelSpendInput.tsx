"use client";

import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { apiErrorPayload, LocalizedFailure } from "./analyticsFetchError";
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
  // The route answers a refused or failed write with a CODE — ANALYTICS_POLICY_FORBIDDEN
  // (403, the seat may not run recruiter operations) or ANALYTICS_SPEND_SAVE_FAILED
  // (500, the write fell over). This editor threw a bare `new Error()` for both, so the
  // whole report was one coral border and one flat tooltip: a recruiter denied by policy
  // and a recruiter hitting a locked database saw the same nothing, and the correction
  // they had just made to the cost-per-hire denominator was gone either way.
  const errMsg = useErrorMessage();
  return (
    <InlineNumberSave
      value={value}
      width="w-24"
      inputClassName="text-sm"
      ariaLabel={t("spendAria", { channel: channelLabel })}
      failedTitle={t("spendSaveFailed")}
      announceFailure
      onSave={async (amount) => {
        const r = await fetch("/api/analytics/spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, amountCzk: amount }),
        });
        // Resolved HERE, where the hook lives, and thrown as an already-localized
        // failure — the input renders it verbatim and never sees a server string.
        if (!r.ok) throw new LocalizedFailure(errMsg(await apiErrorPayload(r), t("spendSaveFailed")));
        onSaved();
      }}
    />
  );
}
