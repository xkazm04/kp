// Pure roster logic for the Agents workforce module — no React, no next-intl, so
// it unit-tests under `node --test` (npm run test:unit). The view components map
// the returned keys through the `agentsWorkforce` catalog namespace.
import type { AgentAggregates, AgentStatus, HiredAgentRecord } from "@/app/_lib/db/agents";
import type { BadgeTone } from "@/app/_components/Badge";

/** One roster row as GET /api/agents serves it (report token stripped server-side). */
export type AgentRosterEntry = Omit<HiredAgentRecord, "reportToken"> & { aggregates: AgentAggregates };

// status → Badge tone + i18n suffix (agentsWorkforce.status.<key>). Typed as an
// exhaustive Record over the AgentStatus union so adding a status in the DB
// contract is a compile error here until the roster handles it.
export const STATUS_BADGE: Record<AgentStatus, { tone: BadgeTone; key: string }> = {
  dispatched: { tone: "info", key: "dispatched" },
  pending_approval: { tone: "caution", key: "pendingApproval" },
  onboarding: { tone: "info", key: "onboarding" },
  active: { tone: "positive", key: "active" },
  rejected: { tone: "critical", key: "rejected" },
  failed: { tone: "critical", key: "failed" },
  retired: { tone: "neutral", key: "retired" },
};

export type MetricSpec = { key: string; label: string; target: number; unit: string; direction: string };

/** The stored metrics blob, defensively narrowed (it crosses a JSON boundary). */
export function metricsOf(raw: unknown): MetricSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
    .filter((m) => typeof m.key === "string" && typeof m.target === "number" && Number.isFinite(m.target))
    .map((m) => ({
      key: m.key as string,
      label: typeof m.label === "string" && m.label ? m.label : (m.key as string),
      target: m.target as number,
      unit: typeof m.unit === "string" ? m.unit : "",
      direction: m.direction === "lte" ? "lte" : "gte",
    }));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The live value behind a metric key, from the roster aggregates. null = this
 *  key has no client-side mapping (or no signal yet) — an honest "no data",
 *  never a fabricated 0. `runs_per_week` is approximated from total runs over
 *  the agent's age (the ledger carries no per-week buckets). */
export function metricActual(
  key: string,
  aggregates: AgentAggregates,
  agentCreatedAt: string,
  now: Date = new Date()
): number | null {
  const k = key.toLowerCase();
  if (k.includes("success")) {
    return aggregates.successRate == null ? null : Math.round(aggregates.successRate * 1000) / 10;
  }
  if (k.includes("cost") || k.includes("budget") || k.includes("spend")) {
    return aggregates.monthCostUsd;
  }
  if (k.includes("per_week")) {
    const created = Date.parse(agentCreatedAt);
    if (!Number.isFinite(created)) return null;
    const weeks = Math.max(1, (now.getTime() - created) / WEEK_MS);
    return Math.round((aggregates.runs / weeks) * 10) / 10;
  }
  if (k.includes("run")) return aggregates.runs;
  return null;
}

export type MetricRow = { metric: MetricSpec; actual: number | null; state: "met" | "missed" | "nodata" };
export type ExpectationsVerdict = { met: number; total: number; hasData: boolean; rows: MetricRow[] };

/** The "n/m met" expectations verdict, computed client-side from the metrics the
 *  agent was hired against vs its reported aggregates. Before ANY activity has
 *  been reported (lastActivityAt null) every row is `nodata` — a just-dispatched
 *  agent is not "missing" its targets, it simply hasn't reported yet. */
export function expectationsVerdict(
  metrics: MetricSpec[],
  aggregates: AgentAggregates,
  agentCreatedAt: string,
  now: Date = new Date()
): ExpectationsVerdict {
  const hasData = aggregates.lastActivityAt != null;
  const rows: MetricRow[] = metrics.map((metric) => {
    const actual = hasData ? metricActual(metric.key, aggregates, agentCreatedAt, now) : null;
    if (actual == null) return { metric, actual: null, state: "nodata" };
    const met = metric.direction === "lte" ? actual <= metric.target : actual >= metric.target;
    return { metric, actual, state: met ? "met" : "missed" };
  });
  return { met: rows.filter((r) => r.state === "met").length, total: rows.length, hasData, rows };
}

export type ConnectorUseSummary = { top: { name: string; calls: number }[]; more: number };

/** Top-N connectors by call count (ties broken alphabetically for stable render). */
export function topConnectors(connectors: Record<string, number>, n = 3): ConnectorUseSummary {
  const sorted = Object.entries(connectors)
    .map(([name, calls]) => ({ name, calls: Number(calls) || 0 }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
  return { top: sorted.slice(0, n), more: Math.max(0, sorted.length - n) };
}

/** The spec'd connector list (for agents with no reported connector use yet). */
export function specConnectors(spec: unknown): string[] {
  const list = (spec as { connectors?: unknown } | null)?.connectors;
  return Array.isArray(list) ? list.filter((c): c is string => typeof c === "string" && !!c) : [];
}

/** Compact USD money — whole dollars unless cents matter. */
export function fmtUsd(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

/** Month spend as a 0..1 fraction of budget (null when there is no budget to
 *  compare against, or a nonsensical one). Capped at 1 for the bar width. */
export function budgetFraction(monthCostUsd: number, budgetUsd: number | null): number | null {
  if (budgetUsd == null || !(budgetUsd > 0)) return null;
  return Math.min(1, monthCostUsd / budgetUsd);
}
