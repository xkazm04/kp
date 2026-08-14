"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { BTN_SECONDARY, PANEL, PANEL_SUNKEN } from "@/app/_components/ui/recipes";
import { labelize } from "@/app/_lib/format";
import type { LlmUsageAggregateRow } from "@/app/_lib/db/llm";
import { foldByUseCase, sumTotals } from "./modelsUsagePanelLogic";
import { ModelsSystemStrip } from "./ModelsSystemStrip";

// Usage & cost panel — the Models tab's read surface over the llm_usage ledger
// (GET /api/llm/usage). The route returns per (day × use_case × provider ×
// model) rollups; this panel folds them per use case (calls, tokens in/out,
// cached, est. cost USD) and shows the prompt-cache hit stats underneath.
// Read-only telemetry: no actions, so an empty ledger is a quiet sunken note,
// not an error. The fold (incl. the deterministic-vs-LLM split #5 and the
// unpriced-cost signal #3) lives in usage-panel-logic.ts so it's unit-testable.
//
// This is now the single LLM-telemetry overview: the Background-tasks tab's
// standalone "System" card was reporting the same prompt cache and a 7-day token
// total this ledger already covers per use case over 30 days, so it was folded in
// as ModelsSystemStrip (engine availability, run queue, automation clock, 7-day
// analyze rollups, stage timings, comms/schedule failure counters) and its
// duplicated halves were dropped rather than kept in two places.

type UsagePayload = {
  days: number;
  rows: LlmUsageAggregateRow[];
  promptCache: { rows: number; expiredBacklog: number };
};

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
  const sum = sumTotals(totals);
  // #3: any unpriced (Azure / unknown-model) spend anywhere means the cost column
  // undercounts — surface a footnote so $0.00 is never read as authoritative.
  const anyUnpriced = sum.unpricedCalls > 0;

  return (
    <div className={`${PANEL} p-5`}>
      <h3 className="flex items-center gap-2 font-serif text-h3 text-ink">
        <Activity size={16} className="text-coral" aria-hidden /> {t("title")}
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-steel">{t("intro", { days: data?.days ?? 30 })}</p>

      {/* Engine health first: a stalled scheduler or a missing key is the context
          that explains a suspiciously cheap week in the ledger below. Owns its own
          /api/ops fetch, so it never gates the ledger's. */}
      <ModelsSystemStrip />

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

      {/* Loading choreography tier 2: reserve the ledger's height, show nothing. */}
      {!data && !loadFailed ? <div className="reveal-quiet mt-3 min-h-[6rem]" aria-hidden /> : null}

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
                      <td className="nums py-2 pr-3 text-right text-steel">
                        {format.number(row.calls)}
                        {/* #5: template fallbacks (provider="deterministic") never hit an
                            LLM — call them out so the count isn't read as all real spend. */}
                        {row.deterministicCalls > 0 ? (
                          <span className="block text-meta text-dial-stone">
                            {t("fallbackCalls", { count: row.deterministicCalls })}
                          </span>
                        ) : null}
                      </td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.inputTokens)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.outputTokens)}</td>
                      <td className="nums py-2 pr-3 text-right text-steel">{format.number(row.cachedTokens)}</td>
                      <td className="nums py-2 text-right font-medium text-ink">
                        {cost(row.costUsd)}
                        {/* #3: NULL-cost (Azure / unknown-model) rows summed to $0 — say so
                            rather than presenting an authoritative-looking figure. */}
                        {row.unpricedCalls > 0 ? (
                          <span className="block text-meta font-normal text-dial-stone">
                            {t("unpricedCalls", { count: row.unpricedCalls })}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-3 font-semibold text-ink">{t("total")}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">
                      {format.number(sum.calls)}
                      {sum.deterministicCalls > 0 ? (
                        <span className="block text-meta font-normal text-dial-stone">
                          {t("fallbackCalls", { count: sum.deterministicCalls })}
                        </span>
                      ) : null}
                    </td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.inputTokens)}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.outputTokens)}</td>
                    <td className="nums py-2 pr-3 text-right font-semibold text-ink">{format.number(sum.cachedTokens)}</td>
                    <td className="nums py-2 text-right font-semibold text-ink">
                      {cost(sum.costUsd)}
                      {sum.unpricedCalls > 0 ? (
                        <span className="block text-meta font-normal text-dial-stone">
                          {t("unpricedCalls", { count: sum.unpricedCalls })}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {anyUnpriced ? (
            <p className="mt-3 text-sm text-dial-stone">{t("unpricedNote")}</p>
          ) : null}
          <p className="mt-3 border-t border-stone-200 pt-3 text-sm text-steel">
            {t("cache", { rows: data.promptCache.rows, expired: data.promptCache.expiredBacklog })}
          </p>
        </>
      ) : null}
    </div>
  );
}
