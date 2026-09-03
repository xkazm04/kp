"use client";

/**
 * Usage & cost — the attribution chart.
 *
 * Metaphor: the ledger IS the chart. A table sorted by cost still makes the
 * reader compare numbers themselves, and the question a recruiter actually asks
 * about an AI bill is not "what are the totals" but *which part of my hiring
 * work is eating it*. One proportional bar per use case, widest first, with its
 * share of total spend stated, makes "role intake costs four times what JD
 * ingest does" a glance rather than a calculation.
 *
 * What it demotes, deliberately: the plan allowance is a narrow left rail (an
 * entitlement constrains the chart, it is not a peer of it) and engine health
 * collapses to a footer line — someone here to attribute spend is not triaging
 * the scheduler. The failure counters in that footer render only when non-zero,
 * so a real alarm still reaches the only screen that carries it while a healthy
 * system stays quiet.
 *
 * Chosen over two rejected directions: a "Statement" (one headline figure, then
 * ruled bands of arithmetic — ranks well, explains nothing) and a "Cockpit" (a
 * uniform gauge grid where a plan allowance and a cache-hit rate are the same
 * instrument — reads at a glance, but flattens the one hierarchy that matters).
 *
 * Data-concrete: every bar is a real use case the operator recognises from the
 * Models routing table, labelled through the same catalog, so the chart and the
 * routing pins name the same things.
 */

import { useFormatter, useTranslations } from "next-intl";
import { CARD_PAD, DIVIDER, META_LABEL, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import { MeterRow } from "../BillingUsageMeterRow";
import type { BillingPayload } from "../billingTypes";
import { foldByUseCase, sumTotals, type UseCaseTotals } from "./spendUsageFold";
import { SpendEngineFacts } from "./SpendEngineFacts";
import type { SpendData } from "./useSpendData";

/** Use-case display name with the app-wide has() fallback — a use case added on
 *  the server before the catalog catches up renders labelized, never crashes. */
function useUseCaseLabel(): (useCase: string) => string {
  const t = useTranslations("models");
  return (useCase: string) => {
    const key = `useCases.${useCase}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : labelize(useCase);
  };
}

/** One attribution row: label, proportional bar, cost + share of total. */
function ShareRow({
  row,
  total,
  label,
  cost,
  share,
  callsLabel,
}: {
  row: UseCaseTotals;
  total: number;
  label: string;
  cost: string;
  share: string;
  callsLabel: string;
}) {
  // Bars are proportional to SPEND. A zero-cost use case still shows a hairline
  // so a free/unpriced row is visible rather than silently absent.
  const pct = total > 0 ? Math.max(1, Math.round((row.costUsd / total) * 100)) : 0;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="min-w-0 truncate text-base font-medium text-ink">{label}</span>
        <span className="shrink-0 text-base font-semibold text-ink nums">
          {cost} <span className="font-normal text-steel">{share}</span>
        </span>
      </div>
      <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-coral" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-sm text-steel nums">{callsLabel}</p>
    </li>
  );
}

export function BillingSpendPanel({
  data,
  spend,
  meterName,
}: {
  data: BillingPayload;
  spend: SpendData;
  meterName: (meter: string) => string;
}) {
  const t = useTranslations("billing.spend");
  const tUsage = useTranslations("models.usage");
  const format = useFormatter();
  const labelFor = useUseCaseLabel();
  const { usage, ops } = spend;

  const totals = usage ? foldByUseCase(usage.rows) : [];
  const sum = sumTotals(totals);
  const days = usage?.days ?? 30;
  const money = (value: number) =>
    format.number(value, { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 });

  return (
    <div className={`${PANEL} ${CARD_PAD}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-h3 text-ink">{t("title")}</h3>
        <span className={META_LABEL}>{t("windowDays", { days })}</span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-steel">{t("intro")}</p>

      <div className="mt-4 grid gap-5 lg:grid-cols-[16rem_1fr]">
        {/* Rail: the entitlement the chart is spent against. */}
        <aside className={`${PANEL_SUNKEN} h-fit p-3`}>
          <p className={META_LABEL}>{t("allowance")}</p>
          {data.meters.length === 0 ? (
            <p className="mt-2 text-sm text-steel">{tUsage("empty")}</p>
          ) : (
            <div className="mt-3 space-y-4">
              {data.meters.map((meter) => (
                <MeterRow key={meter.meter} meter={meter} name={meterName(meter.meter)} />
              ))}
            </div>
          )}
        </aside>

        {/* The chart. */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            {/* The two halves of this row answer at DIFFERENT scopes and nothing said
                so: the allowance rail on the left is the caller's org (billingOverview
                → billingOrgForWorkspace), while the AI ledger behind this chart carries
                no org or workspace column at all (`llm_usage`, app/_lib/db/core.ts — it
                is tenancy-EXEMPT config/metering), so it is deployment-wide. Reading a
                deployment total as "my team's spend" against a team's allowance is a
                wrong number presented as a right one. Scoping the aggregate is not
                available without a schema change, so the surface states its scope. */}
            <div>
              <p className={META_LABEL}>{t("breakdown")}</p>
              <p className="mt-0.5 text-sm text-steel">{t("breakdownScope")}</p>
            </div>
            <div className="text-right">
              <p className={META_LABEL}>{t("statCost")}</p>
              <p className="font-serif text-h2 leading-none text-ink nums">
                {format.number(sum.costUsd, { style: "currency", currency: "USD", maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>
          {totals.length === 0 ? (
            <p className="mt-3 text-base text-steel">{t("noSpend")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-stone-100">
              {totals.map((row) => (
                <ShareRow
                  key={row.useCase}
                  row={row}
                  total={sum.costUsd}
                  label={labelFor(row.useCase)}
                  cost={money(row.costUsd)}
                  share={
                    sum.costUsd > 0
                      ? `· ${format.number(row.costUsd / sum.costUsd, { style: "percent", maximumFractionDigits: 0 })}`
                      : ""
                  }
                  callsLabel={[
                    tUsage("colCalls"),
                    format.number(row.calls),
                    row.deterministicCalls > 0 ? `· ${tUsage("fallbackCalls", { count: row.deterministicCalls })}` : "",
                    row.unpricedCalls > 0 ? `· ${tUsage("unpricedCalls", { count: row.unpricedCalls })}` : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
              ))}
            </ul>
          )}
          {sum.unpricedCalls > 0 ? <p className="mt-3 text-sm text-dial-stone">{tUsage("unpricedNote")}</p> : null}
        </div>
      </div>

      {/* Footer: engine context, not triage. */}
      {ops ? (
        <div className={`mt-5 ${DIVIDER} pt-4`}>
          <p className={META_LABEL}>{t("engineTitle")}</p>
          <div className="mt-2">
            <SpendEngineFacts ops={ops} />
          </div>
          {usage ? (
            <p className="mt-2 text-sm text-steel">
              {tUsage("cache", { rows: usage.promptCache.rows, expired: usage.promptCache.expiredBacklog })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
