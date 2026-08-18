"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useNumberFormat } from "@/app/_lib/use-number-format";
import type { Analytics } from "./AnalyticsTab";

// compute-cost-per-hire — surface the (read-only) LLM usage ledger beside the
// recruiter-entered channel spend. HONEST by construction: the ledger has no
// workspace_id (account-wide — the panel says so), prices in USD not the app currency
// (labelled USD, never fake-converted), unpriced calls are flagged (a "$0" that means
// "cost unknown"), and the blended per-hire shows manual (CZK) and compute (USD)
// side by side WITHOUT summing across currencies. The manual leg keeps the CPA
// windowing discipline (all-time only; "—" + note in a windowed view).
//
// Loading choreography (docs/design/loading-choreography.md, tier 3): split out of
// AnalyticsTab.tsx into its own next/dynamic chunk — it's a secondary, below-the-fold
// readout nobody opens Analytics to see first.
export function ComputeCostPanel({
  computeCost,
  costPerHireCzk,
  costPerHireAsOf,
  windowed,
}: {
  // UAT KAT-ANA-4/KAT-ANA-7 — widened over the client mirror in AnalyticsTypes.ts with
  // the two fields that make the number self-describing: the PERIOD it covers and the
  // HIRE COUNT it divided by. Optional so the mirror needs no edit (see economicsTypes.ts).
  computeCost:
    | (NonNullable<Analytics["computeCost"]> & { windowDays?: number | null; hires?: number })
    | null;
  costPerHireCzk: number | null;
  /** Oldest `channel_spend.updated_at` behind the manual leg (UAT KAT-ANA-2). */
  costPerHireAsOf?: string | null;
  windowed: boolean;
}) {
  const t = useTranslations("analytics.compute");
  const ta = useTranslations("analytics");
  // The manual (CZK) leg groups its digits in the READER's locale, like every
  // other money figure (format.ts number-locale contract). Named `money` rather
  // than destructured onto `n` because `n` is the usd() parameter below.
  const { money } = useNumberFormat();
  const format = useFormatter();
  const usd = (n: number) => format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  const shortDate = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short", year: "numeric" });
  // The hire count the server actually divided by (hires CLOSED in the window). Falls
  // back to 0 rather than to a cohort count: a missing denominator must read as "no
  // hires yet", never as a different population silently standing in.
  const hires = computeCost?.hires ?? 0;
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-panel">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-h2 text-ink">{t("title")}</h3>
        <span className="rounded-full border border-stone-200 px-2 py-0.5 text-meta uppercase tracking-wide text-steel">
          {t("estimate")}
        </span>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro")}</p>

      {computeCost == null ? (
        <p className="mt-3 rounded-md bg-paper p-3 text-base text-steel">{t("empty")}</p>
      ) : (
        <>
          <p className="mt-3 font-serif text-display leading-none text-ink">{usd(computeCost.costUsd)}</p>
          {/* UAT KAT-ANA-7 — the basis names its PERIOD, not just its call count. The
              same ledger is read all-time here and 30-day on Billing; with neither
              surface stating its window, two honest numbers disagreed in public and
              no reader could tell why. */}
          <p className="mt-1 text-sm text-steel">
            {computeCost.windowDays != null
              ? t("basisWindowed", { calls: computeCost.calls, days: computeCost.windowDays })
              : t("basisAllTime", { calls: computeCost.calls })}
          </p>
          <p className="mt-0.5 text-sm text-steel">{t("accountScope")}</p>
          {computeCost.unpricedCalls > 0 ? (
            <p className="mt-0.5 text-sm text-dial-amber">
              {t("unpriced", { count: computeCost.unpricedCalls, zero: usd(0) })}
            </p>
          ) : null}

          {/* Blended cost per hire — two currencies, side by side, never summed (no FX). */}
          <div className="mt-4 border-t border-stone-200 pt-3">
            <h4 className="text-meta uppercase tracking-wide text-steel">{t("perHireTitle")}</h4>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-md bg-paper p-3">
              <div>
                <dt className="text-meta uppercase tracking-wide text-steel">{t("computePerHire")}</dt>
                {computeCost.workspaceCount > 1 ? (
                  // Tenant-scope honesty: the ledger is account-wide (no workspace_id)
                  // but hires are this workspace's — a per-hire ratio would inflate ~by
                  // the number of active workspaces, so it's suppressed rather than faked.
                  <dd className="mt-0.5 text-sm text-steel">{t("perHireMultiWorkspace")}</dd>
                ) : (
                  <>
                    <dd className="mt-0.5 font-serif text-h3 text-ink">
                      {computeCost.costPerHireUsd != null ? `${usd(computeCost.costPerHireUsd)} ${t("perHireUnit")}` : "—"}
                    </dd>
                    {/* UAT KAT-ANA-4 — name the denominator AND its basis. This used to
                        read "over N hired" where N was the creation COHORT while the
                        numerator was ledger-time, so the two halves of one ratio
                        described different populations. It now divides by, and states,
                        the hires that CLOSED in the same period. */}
                    <dd className="text-xs text-steel">
                      {hires <= 0
                        ? t("noHires")
                        : computeCost.windowDays != null
                          ? t("perHireClosedWindow", { hired: hires, days: computeCost.windowDays })
                          : t("perHireHires", { hired: hires })}
                    </dd>
                  </>
                )}
              </div>
              <div>
                <dt className="text-meta uppercase tracking-wide text-steel">{t("manualPerHire")}</dt>
                <dd className="mt-0.5 font-serif text-h3 text-ink">
                  {costPerHireCzk != null ? `${money(costPerHireCzk)} ${t("perHireUnit")}` : "—"}
                </dd>
                <dd className="text-xs text-steel">{windowed ? t("manualWindowed") : t("manualAllTime")}</dd>
                {/* UAT KAT-ANA-2 — the manual leg is Σ typed-in channel spend ÷ hires.
                    Nothing about it moves when it goes stale, so it says when it was
                    last entered; "oldest" because a blend is only as current as its
                    stalest input. */}
                {costPerHireCzk != null && costPerHireAsOf ? (
                  <dd className="text-xs text-steel">
                    {ta("spendAsOfOldest", { date: shortDate(costPerHireAsOf) })}
                  </dd>
                ) : null}
              </div>
            </dl>
            <p className="mt-2 text-sm text-steel">{t("perHireNote")}</p>
          </div>
        </>
      )}
    </div>
  );
}
