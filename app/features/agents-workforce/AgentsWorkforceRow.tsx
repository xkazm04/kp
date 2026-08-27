"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/app/_components/Badge";
import { BTN_SECONDARY, CHIP_QUIET, META_LABEL } from "@/app/_components/ui/recipes";
import { buildUrl } from "@/app/features/shell/tabs";
import {
  BACKBONE_GLYPH,
  BACKBONE_TEXT,
  budgetFraction,
  expectationsVerdict,
  fmtUsd,
  metricsOf,
  probationCountdown,
  specConnectors,
  STATUS_BADGE,
  topConnectors,
  memoryChip,
  type AgentRosterEntry,
} from "./agentsWorkforceLogic";

// One roster row: the summary <tr> plus, when expanded, the detail <tr> with the
// full metrics-vs-actuals list and the pull-fallback status refresh.
//
// An APP MASTER row (docs/features/app-master/README.md) carries a second,
// harder story on the same six columns: its mandate rung and autopilot mode ride
// beside the status badge, its expectations column leads with the deterministic
// backbone verdict (✓ pass / – incomplete / ✗ fail) instead of a run-count
// proxy, and the expanded detail shows every rule's contribution, the gates, and
// the probation countdown. Nothing here re-scores anything: the verdict, the
// contributions and the reasons all come from the server's backbone dict.

const ROW_STATE_GLYPH = { met: "✓", missed: "✗", nodata: "–" } as const;
const ROW_STATE_TEXT = { met: "text-score-strong", missed: "text-score-weak", nodata: "text-score-null" } as const;

// next-intl keys are typed, so the rung cannot be interpolated. The ladder is
// closed at 0..2 (3 and 4 are never grantable), so the explicit map is also the
// honest shape.
const RUNG_KEY = ["appMaster.rung.0", "appMaster.rung.1", "appMaster.rung.2"] as const;

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
  const verdict = expectationsVerdict(metrics, agent.aggregates, agent.createdAt, new Date(), agent.kpiDeltas);
  const appMaster = agent.appMaster;
  const backbone = agent.backbone;
  const probation = probationCountdown(agent);
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
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={badge.tone} label={t(`status.${badge.key}` as Parameters<typeof t>[0])} />
            {appMaster ? <span className={CHIP_QUIET}>{t("appMaster.label")}</span> : null}
            {appMaster?.autopilotMode ? (
              <span className={CHIP_QUIET}>
                {t(`appMaster.autopilot.${appMaster.autopilotMode}` as Parameters<typeof t>[0])}
              </span>
            ) : null}
            {memoryChip(appMaster?.memory ?? null) ? (
              // Accumulated experience (persona-memory tiers) — tenure made
              // visible: a veteran hire and a day-one hire read differently.
              <span className={CHIP_QUIET} title={t("appMaster.memory.title")}>
                {t("appMaster.memory.chip", { counts: memoryChip(appMaster?.memory ?? null) ?? "" })}
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3">
          {/* An App master hired from an intake owns an APPLICATION — there is
              no job posting to navigate to, so the role reads as plain text
              rather than a link that would 404 into an empty job. */}
          {agent.jobId ? (
            <button
              type="button"
              onClick={() => router.push(buildUrl({ tab: "jobs", job: agent.jobId }, search.toString()))}
              className="focus-ring text-base text-steel hover:text-coral hover:underline"
            >
              {agent.jobTitle}
            </button>
          ) : (
            <span className="text-base text-steel">{agent.jobTitle}</span>
          )}
          {appMaster ? (
            <div className="mt-0.5 text-sm text-stone-500">
              {appMaster.scopeRung != null && appMaster.scopeRung >= 0 && appMaster.scopeRung <= 2
                ? t(RUNG_KEY[appMaster.scopeRung])
                : t("appMaster.rung.unknown")}
            </div>
          ) : null}
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
          {/* An App master is judged by its deterministic backbone first: the
              n/m objective count is a detail of it, not the headline. */}
          {appMaster && backbone ? (
            <>
              <span className={`${BACKBONE_TEXT[backbone.verdict]} font-semibold`}>
                <span aria-hidden>{BACKBONE_GLYPH[backbone.verdict]}</span>{" "}
                {t(`appMaster.backbone.verdict.${backbone.verdict}` as Parameters<typeof t>[0])}
              </span>
              <span className="block text-sm text-steel">
                {backbone.score == null
                  ? t("appMaster.backbone.noScore")
                  : t("appMaster.backbone.scoreLine", {
                      score: Math.round(backbone.score * 100),
                      coverage: Math.round(backbone.coverage * 100),
                    })}
              </span>
            </>
          ) : appMaster ? (
            <span className="text-steel">{t("appMaster.backbone.none")}</span>
          ) : verdict.total === 0 || !verdict.hasData ? (
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
            {appMaster ? (
              <div className="mb-3 max-w-3xl space-y-2">
                {probation ? (
                  <p className="text-sm text-steel nums">
                    {probation.due
                      ? t("appMaster.probationDue", { total: probation.totalDays })
                      : t("appMaster.probationLeft", { left: probation.daysLeft, total: probation.totalDays })}
                  </p>
                ) : null}
                <p className={META_LABEL}>{t("appMaster.backbone.title")}</p>
                {!backbone ? (
                  <p className="text-sm text-steel">{t("appMaster.backbone.none")}</p>
                ) : (
                  <>
                    {/* Per-rule contributions, exactly as the scorer attributed
                        them. An unmeasured rule shows a dash and its reason —
                        never a 0, which would read as "scored badly". */}
                    <ul className="space-y-1">
                      {backbone.rules.map((rule) => (
                        <li key={rule.rule} className="flex items-baseline gap-2 text-sm">
                          <span
                            aria-hidden
                            className={`w-4 shrink-0 text-center font-bold ${rule.measured ? "text-score-strong" : "text-score-null"}`}
                          >
                            {rule.measured ? "✓" : "–"}
                          </span>
                          <span className="min-w-0 flex-1 text-ink">
                            {rule.label}
                            <span className="block text-stone-500">{rule.reason}</span>
                          </span>
                          <span className="shrink-0 text-steel nums">
                            {rule.contribution == null
                              ? t("appMaster.backbone.unmeasured")
                              : t("appMaster.backbone.contribution", { earned: rule.contribution, weight: rule.weight })}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {/* A gate is not a weight: a failed gate fails the verdict
                        outright, so it is listed apart from the rules. */}
                    <ul className="space-y-0.5">
                      {backbone.gates.map((gate) => (
                        <li key={gate.gate} className="flex items-baseline gap-2 text-sm">
                          <span
                            aria-hidden
                            className={`w-4 shrink-0 text-center font-bold ${gate.passed ? "text-score-strong" : "text-score-weak"}`}
                          >
                            {gate.passed ? "✓" : "✗"}
                          </span>
                          <span className="min-w-0 flex-1 text-steel">{gate.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
            <p className={META_LABEL}>
              {verdict.source === "kpiDeltas" ? t("detail.objectivesHeading") : t("detail.metricsHeading")}
            </p>
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
