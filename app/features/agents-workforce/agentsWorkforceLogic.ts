// Pure roster logic for the Agents workforce module — no React, no next-intl, so
// it unit-tests under `node --test` (npm run test:unit). The view components map
// the returned keys through the `agentsWorkforce` catalog namespace.
import type { AgentAggregates, AgentStatus, HiredAgentRecord } from "@/app/_lib/db/agents";
import type { BadgeTone } from "@/app/_components/Badge";
import type { BackboneScore } from "@/app/_lib/app-master/backbone";
import { kpiMoved } from "@/app/_lib/app-master/backbone";
import type { AutopilotMode, ReportedKpiDelta } from "@/app/_lib/agent-hire/report-payload";

/** The four App-master facts the roster renders, as GET /api/agents projects
 *  them off the dispatched spec. Null on a task-agent row. */
export type AppMasterProjection = {
  population: "human" | "agent" | "either";
  scopeRung: number | null;
  probationDays: number | null;
  /** Personas' own reading, from the latest rollup — null until one reports. */
  autopilotMode: AutopilotMode | null;
  /** Persona-memory tier counts — accumulated experience; null until reported. */
  memory: { core: number; active: number; working: number; archived: number } | null;
};

/** Compact memory chip text: "3 core · 41 active", null when nothing reported.
 *  Archived is deliberately omitted from the chip — it is history, not the
 *  working mind; the detail view is where it belongs. */
export function memoryChip(memory: AppMasterProjection["memory"]): string | null {
  if (!memory) return null;
  const live = memory.core + memory.active + memory.working;
  if (live <= 0) return null;
  return `${memory.core} core · ${memory.active + memory.working} active`;
}

/** One roster row as GET /api/agents serves it (report token stripped server-side). */
export type AgentRosterEntry = Omit<HiredAgentRecord, "reportToken"> & {
  aggregates: AgentAggregates;
  /** Present ⇒ an App-master hire. */
  appMaster: AppMasterProjection | null;
  /** The deterministic verdict for the latest reported window; null = no record yet. */
  backbone: BackboneScore | null;
  /** The per-objective readings behind that verdict. */
  kpiDeltas: ReportedKpiDelta[] | null;
};

/** True for a row the App-master surfaces apply to. */
export function isAppMaster(agent: AgentRosterEntry): boolean {
  return agent.appMaster != null;
}

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

// A cost metric is either a PER-UNIT ceiling or a period total, and the two are
// not interchangeable. agentfit.py's shipped deterministic metric is
// `cost_per_task` (target = suggested monthly budget / 20 runs), and the LLM path
// may name any snake_case key — so classify before comparing.
const COST_RATE_KEY = /per[_-]?(task|run|exec|execution|job|call|item)/;

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
    // Spend is a MEASUREMENT only once something has actually been costed: the
    // provider CLI reports $0 on subscription auth (the `spendNote` copy says so
    // in as many words), so an uncosted ledger is "no data" — never a green ✓
    // against a cost ceiling the agent was never measured against.
    if (!(aggregates.costUsd > 0)) return null;
    if (COST_RATE_KEY.test(k)) {
      // A per-task ceiling is a RATE. Comparing it against the month's TOTAL
      // spend reported every busy-but-cheap agent as far over its per-task
      // budget ($10 of month spend vs a $2.17/task ceiling read as "missed"
      // while the agent was actually spending $0.50 a task).
      return aggregates.runs > 0 ? Math.round((aggregates.costUsd / aggregates.runs) * 100) / 100 : null;
    }
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
export type ExpectationsVerdict = {
  met: number;
  total: number;
  hasData: boolean;
  rows: MetricRow[];
  /** Which ledger answered: the reported KPI deltas (App master) or the run/spend
   *  aggregates (task agent). The UI labels the column accordingly — the two are
   *  not the same claim. */
  source: "kpiDeltas" | "aggregates";
};

/** The "n/m met" expectations verdict, computed client-side from the metrics the
 *  agent was hired against vs its reported aggregates. Before ANY activity has
 *  been reported (lastActivityAt null) every row is `nodata` — a just-dispatched
 *  agent is not "missing" its targets, it simply hasn't reported yet.
 *
 *  `kpiDeltas` (reporter v2) takes over when present: an App master is hired
 *  against a value ledger, and matching its objectives to run counts and spend
 *  would answer a question nobody asked. Each objective is matched to its delta
 *  BY KEY; an objective with no delta, or one whose delta says `measured:false`,
 *  reads `nodata` — the same discipline the backbone applies (an unread meter is
 *  a coverage gap, never a miss). */
export function expectationsVerdict(
  metrics: MetricSpec[],
  aggregates: AgentAggregates,
  agentCreatedAt: string,
  now: Date = new Date(),
  kpiDeltas: ReportedKpiDelta[] | null = null
): ExpectationsVerdict {
  if (kpiDeltas && kpiDeltas.length > 0) {
    const byKey = new Map(kpiDeltas.map((d) => [d.kpiKey, d]));
    const rows: MetricRow[] = metrics.map((metric) => {
      const delta = byKey.get(metric.key);
      const moved = delta ? kpiMoved(delta) : null;
      if (!delta || moved === null) return { metric, actual: delta?.current ?? null, state: "nodata" };
      return { metric, actual: delta.current, state: moved ? "met" : "missed" };
    });
    return {
      met: rows.filter((r) => r.state === "met").length,
      total: rows.length,
      hasData: rows.some((r) => r.state !== "nodata"),
      rows,
      source: "kpiDeltas",
    };
  }
  const hasData = aggregates.lastActivityAt != null;
  const rows: MetricRow[] = metrics.map((metric) => {
    const actual = hasData ? metricActual(metric.key, aggregates, agentCreatedAt, now) : null;
    if (actual == null) return { metric, actual: null, state: "nodata" };
    const met = metric.direction === "lte" ? actual <= metric.target : actual >= metric.target;
    return { metric, actual, state: met ? "met" : "missed" };
  });
  return { met: rows.filter((r) => r.state === "met").length, total: rows.length, hasData, rows, source: "aggregates" };
}

// ---- App master --------------------------------------------------------------

/** The ✓ / – / ✗ convention the eval reports and the intake card already use,
 *  as ONE pair of values. Three vocabularies render through it — a backbone
 *  verdict, a metric row's state, and the bare booleans on a rule or a gate —
 *  and each used to spell the glyph AND the colour token out for itself: four
 *  expressions of one rule across two files, of which the test asserted one.
 *
 *  `unknown` is a DASH, not a soft pass. The backbone reaching "incomplete"
 *  means it could not read enough to judge, and a checkmark there would be the
 *  green lie the rubric it scores exists to prevent; an unmeasured rule is the
 *  same claim, which is why it shares this key rather than borrowing `fail`. */
export const MARK = {
  pass: { glyph: "✓", text: "text-score-strong" },
  unknown: { glyph: "–", text: "text-score-null" },
  fail: { glyph: "✗", text: "text-score-weak" },
} as const;

export type MarkState = keyof typeof MARK;

/** Backbone verdict → mark. Exhaustive over the scorer's union, so a new verdict
 *  is a compile error here until it declares which mark it wears. */
export const BACKBONE_MARK = {
  pass: "pass",
  incomplete: "unknown",
  fail: "fail",
} as const satisfies Record<BackboneScore["verdict"], MarkState>;

/** Metric-row state → mark. `nodata` is the dash for the same reason. */
export const METRIC_MARK = {
  met: "pass",
  missed: "fail",
  nodata: "unknown",
} as const satisfies Record<MetricRow["state"], MarkState>;

export type ProbationCountdown = {
  totalDays: number;
  /** Whole days elapsed since the hire was minted. */
  elapsedDays: number;
  /** Days still to run; 0 once the window has closed. */
  daysLeft: number;
  /** True once the window has closed. This says the review is DUE BY THE CLOCK —
   *  it does NOT mean no probation_review has landed, which is what this line
   *  used to claim and what the function has no way to know. A review decided
   *  `extended` deliberately leaves the agent in `onboarding` ("more time is not
   *  a promotion", report-payload.ts), so the countdown stays at 0 and this stays
   *  true for a review a human already performed. Telling those two apart needs
   *  the last decision on the roster row, which GET /api/agents does not project. */
  due: boolean;
};

/** How far into probation this hire is. Null when there is no probation window
 *  to count (not an App master, or no probationDays on the spec) or once the
 *  agent has left probation — `active` means a human already made the call, and
 *  `rejected`/`failed`/`retired` mean the countdown is moot. */
export function probationCountdown(
  agent: AgentRosterEntry,
  now: Date = new Date()
): ProbationCountdown | null {
  const total = agent.appMaster?.probationDays;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  if (agent.status !== "dispatched" && agent.status !== "pending_approval" && agent.status !== "onboarding") return null;
  const created = Date.parse(agent.createdAt);
  if (!Number.isFinite(created)) return null;
  const elapsed = Math.max(0, Math.floor((now.getTime() - created) / (24 * 60 * 60 * 1000)));
  const left = Math.max(0, Math.round(total) - elapsed);
  return { totalDays: Math.round(total), elapsedDays: elapsed, daysLeft: left, due: left === 0 };
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
