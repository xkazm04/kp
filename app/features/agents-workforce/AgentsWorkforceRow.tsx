"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { BTN_SECONDARY, CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { buildUrl } from "@/app/features/shell/tabs";
import {
  budgetFraction,
  expectationsVerdict,
  fmtUsd,
  metricsOf,
  specConnectors,
  STATUS_BADGE,
  topConnectors,
  type AgentRosterEntry,
} from "./agentsWorkforceLogic";

// One roster row: the summary <tr> plus, when expanded, the detail <tr> with the
// full metrics-vs-actuals list and the pull-fallback status refresh.

const ROW_STATE_GLYPH = { met: "✓", missed: "✗", nodata: "–" } as const;
const ROW_STATE_TEXT = { met: "text-score-strong", missed: "text-score-weak", nodata: "text-score-null" } as const;

export function AgentsWorkforceRow({
  agent,
  expanded,
  onToggle,
  onChanged,
}: {
  agent: AgentRosterEntry;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("agentsWorkforce");
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);

  const badge = STATUS_BADGE[agent.status];
  const name = agent.personaName ?? ((agent.spec as { name?: string } | null)?.name || agent.jobTitle);
  const metrics = metricsOf(agent.metrics);
  const verdict = expectationsVerdict(metrics, agent.aggregates, agent.createdAt);
  const reported = topConnectors(agent.aggregates.connectors);
  const chips = reported.top.length > 0 ? reported : topConnectors(Object.fromEntries(specConnectors(agent.spec).map((c) => [c, 0])));
  const spendFraction = budgetFraction(agent.aggregates.monthCostUsd, agent.budgetUsd);
  const successPct = agent.aggregates.successRate != null ? Math.round(agent.aggregates.successRate * 100) : null;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch(`/api/agents/${encodeURIComponent(agent.id)}/refresh`, { method: "POST" });
      onChanged();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <tr className="border-b border-stone-200 align-top last:border-b-0">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="focus-ring inline-flex items-center gap-1.5 text-base font-semibold text-ink hover:text-coral"
          >
            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {name}
          </button>
          <div className="mt-1">
            <Badge tone={badge.tone} label={t(`status.${badge.key}` as Parameters<typeof t>[0])} />
          </div>
        </td>
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={() => router.push(buildUrl({ tab: "jobs", job: agent.jobId }, search.toString()))}
            className="focus-ring text-base text-steel hover:text-coral hover:underline"
          >
            {agent.jobTitle}
          </button>
        </td>
        <td className="px-4 py-3">
          <span className="text-base text-ink nums" title={t("spendNote", { zero: fmtUsd(0, locale) })}>
            {agent.budgetUsd != null
              ? t("spendOfBudget", {
                  spent: fmtUsd(agent.aggregates.monthCostUsd, locale),
                  budget: fmtUsd(agent.budgetUsd, locale),
                })
              : fmtUsd(agent.aggregates.monthCostUsd, locale)}
          </span>
          {spendFraction != null ? (
            <div aria-hidden className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-stone-100">
              <div
                className={`h-full rounded-full ${spendFraction >= 1 ? "bg-coral" : "bg-moss"}`}
                style={{ width: `${Math.round(spendFraction * 100)}%` }}
              />
            </div>
          ) : null}
        </td>
        <td className="px-4 py-3 text-base text-ink nums">
          {agent.aggregates.runs > 0 ? (
            <>
              {t("runsCount", { count: agent.aggregates.runs })}
              {successPct != null ? <span className="block text-sm text-steel">{t("successRate", { rate: successPct })}</span> : null}
            </>
          ) : (
            <span className="text-steel">{t("noRuns")}</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            {chips.top.map((c) => (
              <span key={c.name} className={CHIP_QUIET}>
                {c.name}
              </span>
            ))}
            {chips.more > 0 ? <span className="text-sm text-steel">{t("moreConnectors", { count: chips.more })}</span> : null}
          </div>
        </td>
        <td className="px-4 py-3 text-base nums">
          {verdict.total === 0 || !verdict.hasData ? (
            <span className="text-steel">{t("expectationsNoData")}</span>
          ) : (
            <span className={verdict.met === verdict.total ? "text-score-strong" : verdict.met === 0 ? "text-score-weak" : "text-ink"}>
              {t("expectationsMet", { met: verdict.met, total: verdict.total })}
            </span>
          )}
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-stone-200 bg-stone-50 last:border-b-0">
          <td colSpan={6} className="px-4 py-4">
            {(agent.spec as { mission?: string } | null)?.mission ? (
              <div className="mb-3 max-w-3xl">
                <p className={META_LABEL}>{t("detail.mission")}</p>
                <p className="mt-0.5 text-sm text-ink">{(agent.spec as { mission?: string }).mission}</p>
              </div>
            ) : null}
            <p className={META_LABEL}>{t("detail.metricsHeading")}</p>
            {verdict.rows.length === 0 ? (
              <p className="mt-1 text-sm text-steel">{t("detail.noMetrics")}</p>
            ) : (
              <ul className="mt-1.5 max-w-xl space-y-1">
                {verdict.rows.map(({ metric, actual, state }) => (
                  <li key={metric.key} className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className={`w-4 shrink-0 text-center font-bold ${ROW_STATE_TEXT[state]}`}>
                      {ROW_STATE_GLYPH[state]}
                    </span>
                    <span className="min-w-0 flex-1 text-ink">{metric.label}</span>
                    <span className="shrink-0 text-steel nums">
                      {state === "nodata" ? t("detail.noData") : `${actual} ${metric.unit}`.trim()}
                      {" · "}
                      {metric.direction === "lte" ? "≤" : "≥"} {metric.target} {metric.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-sm text-stone-500">{t("spendNote", { zero: fmtUsd(0, locale) })}</p>
            <button type="button" onClick={() => void refresh()} disabled={refreshing} className={`${BTN_SECONDARY} mt-3 h-8 px-3 text-sm`}>
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />
              {refreshing ? t("detail.refreshing") : t("detail.refresh")}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
