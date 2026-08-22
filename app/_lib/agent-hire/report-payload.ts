// Wire-format parsing for the PUBLIC agent report endpoint
// (POST /api/agents/report/[token]) — pure and dependency-free so the trust
// boundary is unit-testable without the route/db import chain.
//
// KP is the CONTRACT SOURCE for these three shapes (Personas WP4 implements the
// sender side against them):
//
//   execution: { "kind": "execution", "execId": "run-42", "personaId": "p-1",
//                "costUsd": 0.12, "tokensIn": 5200, "tokensOut": 900,
//                "status": "success", "durationMs": 8300,
//                "connectorUses": [{ "connector": "gmail", "calls": 3 }] }
//   rollup:    { "kind": "rollup", "period": "2026-08", "runs": 41,
//                "successes": 39, "failures": 2, "costUsd": 4.87,
//                "tokensIn": 210000, "tokensOut": 36000,
//                "connectorUses": [{ "connector": "gmail", "calls": 120 }] }
//   lifecycle: { "kind": "lifecycle", "event": "activated", "personaId": "p-1",
//                "personaName": "Invoice Runner", "reason": null }
//
// Everything is bounded here (string caps, finite non-negative numbers, list
// caps) — the payload is authored by an external process holding only a report
// token, so nothing in it is trusted beyond its shape. The WORKSPACE never comes
// from the payload; the route derives it from the token row.

export const AGENT_LIFECYCLE_EVENTS = ["approved", "onboarding", "activated", "rejected", "retired"] as const;
export type AgentLifecycleEvent = (typeof AGENT_LIFECYCLE_EVENTS)[number];

export type ExecutionReport = {
  kind: "execution";
  execId: string;
  personaId: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  status: "success" | "failure";
  durationMs: number | null;
  connectorUses: { connector: string; calls: number }[];
};

export type RollupReport = {
  kind: "rollup";
  period: string;
  runs: number;
  successes: number;
  failures: number;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  connectorUses: { connector: string; calls: number }[];
};

export type LifecycleReport = {
  kind: "lifecycle";
  event: AgentLifecycleEvent;
  personaId: string | null;
  personaName: string | null;
  reason: string | null;
};

export type AgentReport = ExecutionReport | RollupReport | LifecycleReport;

export type ParseReportResult = { ok: true; report: AgentReport } | { ok: false; error: string };

const MAX_STRING = 200;
const MAX_REASON = 500;
const MAX_CONNECTOR_USES = 50;
// period = "YYYY-MM" (monthly rollup) or "YYYY-MM-DD" (daily).
const PERIOD = /^\d{4}-\d{2}(-\d{2})?$/;

function str(v: unknown, cap = MAX_STRING): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, cap) : null;
}

/** Finite number ≥ 0, else null (never NaN/Infinity/negative into the ledger). */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

function connectorUses(v: unknown): { connector: string; calls: number }[] {
  if (!Array.isArray(v)) return [];
  const out: { connector: string; calls: number }[] = [];
  for (const entry of v.slice(0, MAX_CONNECTOR_USES)) {
    if (!entry || typeof entry !== "object") continue;
    const connector = str((entry as Record<string, unknown>).connector, 100);
    const calls = int((entry as Record<string, unknown>).calls);
    if (connector) out.push({ connector, calls: calls ?? 0 });
  }
  return out;
}

export function parseAgentReport(payload: unknown): ParseReportResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const p = payload as Record<string, unknown>;
  const kind = p.kind;

  if (kind === "execution") {
    const execId = str(p.execId);
    if (!execId) return { ok: false, error: "execution reports require a non-empty execId." };
    const status = p.status === "success" || p.status === "failure" ? p.status : null;
    if (!status) return { ok: false, error: 'execution reports require status "success" or "failure".' };
    return {
      ok: true,
      report: {
        kind: "execution",
        execId,
        personaId: str(p.personaId),
        costUsd: num(p.costUsd),
        tokensIn: int(p.tokensIn),
        tokensOut: int(p.tokensOut),
        status,
        durationMs: int(p.durationMs),
        connectorUses: connectorUses(p.connectorUses),
      },
    };
  }

  if (kind === "rollup") {
    const period = str(p.period, 10);
    if (!period || !PERIOD.test(period)) {
      return { ok: false, error: 'rollup reports require a period like "2026-08" or "2026-08-04".' };
    }
    const successes = int(p.successes) ?? 0;
    const failures = int(p.failures) ?? 0;
    // A rollup that claims more outcomes than runs is internally inconsistent,
    // and the aggregates divide successes by runs: {runs:2, successes:5} put
    // "250% success" on the roster and a ✓ against a "≥ 90%" expectation. A
    // reported success implies a run, so runs is corrected UPWARD to the outcomes
    // actually reported — the period's spend still lands (rejecting the report
    // would lose the ledger row) and the rate can no longer exceed 100%.
    const runs = Math.max(int(p.runs) ?? 0, successes + failures);
    return {
      ok: true,
      report: {
        kind: "rollup",
        period,
        runs,
        successes,
        failures,
        costUsd: num(p.costUsd),
        tokensIn: int(p.tokensIn),
        tokensOut: int(p.tokensOut),
        connectorUses: connectorUses(p.connectorUses),
      },
    };
  }

  if (kind === "lifecycle") {
    const event = (AGENT_LIFECYCLE_EVENTS as readonly string[]).includes(String(p.event))
      ? (p.event as AgentLifecycleEvent)
      : null;
    if (!event) return { ok: false, error: `lifecycle reports require an event in: ${AGENT_LIFECYCLE_EVENTS.join(", ")}.` };
    return {
      ok: true,
      report: {
        kind: "lifecycle",
        event,
        personaId: str(p.personaId),
        personaName: str(p.personaName),
        reason: str(p.reason, MAX_REASON),
      },
    };
  }

  return { ok: false, error: 'kind must be "execution", "rollup" or "lifecycle".' };
}
