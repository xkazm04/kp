"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Skeleton } from "@/app/_components/Skeleton";
import { BTN_SECONDARY, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import type { LlmUsageAggregateRow } from "@/app/_lib/db";

// Usage & cost panel — the Models tab's read surface over the llm_usage ledger
// (GET /api/llm/usage). The route returns per (day × use_case × provider ×
// model) rollups; this panel folds them per use case (calls, tokens in/out,
// cached, est. cost USD) and shows the prompt-cache hit stats underneath.
// Read-only telemetry: no actions, so an empty ledger is a quiet sunken note,
// not an error.

type UsagePayload = {
  days: number;
  rows: LlmUsageAggregateRow[];
  promptCache: { rows: number; expiredBacklog: number };
};

type UseCaseTotals = {
  useCase: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
};

/** Fold the day-level rollups into one row per use case, spendiest first. */
function foldByUseCase(rows: LlmUsageAggregateRow[]): UseCaseTotals[] {
  const byUseCase = new Map<string, UseCaseTotals>();
  for (const row of rows) {
    const acc = byUseCase.get(row.useCase) ?? {
      useCase: row.useCase,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
    };
    acc.calls += row.calls;
    acc.inputTokens += row.inputTokens;
    acc.outputTokens += row.outputTokens;
    acc.cachedTokens += row.cachedTokens;
    acc.costUsd += row.costUsd;
    byUseCase.set(row.useCase, acc);
  }
  return [...byUseCase.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

export function UsagePanel() {
  const t = useTranslations("models.usage");
  const tModels = useTranslations("models");
  const format = useFormatter();
  const [data, setData] = useState<UsagePayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // State updates only happen in the async callbacks (never synchronously in
  // the effect body); the retry button clears the failure flag in its event
  // handler before re-firing.
  const load = useCallback(() => {
    fetch("/api/llm/usage")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((p) => setData(p as UsagePayload))
      .catch(() => setLoadFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Same has() fallback as the routing table: a ledger label without a catalog
  // entry (or a future use case) renders labelized, never crashes.
  const labelFor = (useCase: string): string => {
    const key = `useCases.${useCase}` as Parameters<typeof tModels>[0];
    return tModels.has(key) ? tModels(key) : labelize(useCase);
  };

  const cost = (value: number): string =>
    format.number(value, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

  const totals = data ? foldByUseCase(data.rows) : [];
  const sum = totals.reduce(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      cachedTokens: acc.cachedTokens + r.cachedTokens,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 }
  );

  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <Activity size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro", { days: data?.days ?? 30 })}</p>

      {loadFailed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-base text-coral">{t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => {
              setLoadFailed(false);
              load();
            }}
            className={`${BTN_SECONDARY} h-8 px-3 text-sm`}
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {!data && !loadFailed ? (
        <div role="status" aria-label={t("loading")} className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-2/3 rounded-md" />
        </div>
      ) : null}

      {data ? (
        <>
          {totals.length === 0 ? (
            <p className={`${PANEL_SUNKEN} mt-3 p-3 text-base text-steel`}>{t("empty")}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-base">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-meta uppercase text-steel">
                    <th className="pb-2 pr-3 font-semibold">{t("colUseCase")}</th>
                    <th className="pb-2 pr-3 text-right font-semibold">{t("colCalls")}</th>
                    <th className="pb-2 pr-3 text-right font-semibold">{t("colTokensIn")}</th>
                    <th className="pb-2 pr-3 text-right font-semibold">{t("colTokensOut")}</th>
                    <th className="pb-2 pr-3 text-right font-semibold">{t("colCached")}</th>
                    <th className="pb-2 text-right font-semibold">{t("colCost")}</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((row) => (
                    <tr key={row.useCase} className="border-b border-stone-100">
                      <td className="py-2 pr-3 font-medium text-ink">{labelFor(row.useCase)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.calls)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.inputTokens)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.outputTokens)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.cachedTokens)}</td>
                      <td className="nums py-2 text-right font-medium text-ink">{cost(row.costUsd)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-3 font-semibold text-ink">{t("total")}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.calls)}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.inputTokens)}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.outputTokens)}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.cachedTokens)}</td>
                    <td className="nums py-2 text-right font-semibold text-ink">{cost(sum.costUsd)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 border-t border-stone-200 pt-3 text-sm text-steel">
            {t("cache", { rows: data.promptCache.rows, expired: data.promptCache.expiredBacklog })}
          </p>
        </>
      ) : null}
    </div>
  );
}
