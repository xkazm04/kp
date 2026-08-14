"use client";

// Usage & cost — the section host: it owns the two server reads, the single
// loading state and the single failure state, and hands the resolved data to the
// panel. Layout lives in BillingSpendPanel.
//
// That split is the correction the previous consolidation needed. It nested a
// panel that fetched /api/ops inside a panel that fetched /api/llm/usage, so the
// surface had two borders, two headings and two staggered spinners for what the
// reader experiences as one question. Here the fetching is one layer and the
// drawing is another, and neither knows about the other's chrome.
//
// (This file briefly carried a three-way prototype switcher — Statement /
// Cockpit / attribution chart. The chart won; the other two are deleted.)
import { useTranslations } from "next-intl";
import { BTN_SECONDARY, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import type { BillingPayload } from "../billingTypes";
import { BillingSpendPanel } from "./BillingSpendPanel";
import { useSpendData } from "./useSpendData";

export function BillingSpendSection({
  data,
  meterName,
}: {
  data: BillingPayload;
  meterName: (meter: string) => string;
}) {
  const tUsage = useTranslations("models.usage");
  const spend = useSpendData();

  if (spend.failed) {
    return (
      <div className={`${PANEL_SUNKEN} flex flex-wrap items-center gap-3 p-4`}>
        <p className="text-base text-coral">{tUsage("loadFailed")}</p>
        <button type="button" onClick={spend.reload} className={`${BTN_SECONDARY} h-8 px-3 text-sm`}>
          {tUsage("retry")}
        </button>
      </div>
    );
  }

  // Loading choreography tier 2: hold the section's height, show nothing.
  if (spend.loading) return <div className="reveal-quiet min-h-[22rem]" aria-hidden />;

  return <BillingSpendPanel data={data} spend={spend} meterName={meterName} />;
}
