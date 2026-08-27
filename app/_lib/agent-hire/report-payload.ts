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
// Reporter v2 (App master, docs/features/app-master/README.md) is ADDITIVE on
// both shapes — a Personas build that predates it keeps validating unchanged:
//
//   rollup +  { "proposalsOpened": 8, "proposalsMerged": 6, "proposalsReverted": 1,
//               "gatePassRate": 0.92, "forbiddenClassViolations": 0,
//               "kpiDeltas": [{kpiKey, baseline, current, target, direction,
//                              windowDays, measured}],
//               "budgetReservedUsd": 120, "budgetSettledUsd": 90,
//               "budgetUnmeasured": false, "ledgerConsistent": true,
//               "autopilotMode": "suggest" }
//   lifecycle + event "probation_review" with { "decision": "activated" |
//               "extended" | "retired", "note": "…" }
//
// Everything is bounded here (string caps, finite non-negative numbers, list
// caps) — the payload is authored by an external process holding only a report
// token, so nothing in it is trusted beyond its shape. The WORKSPACE never comes
// from the payload; the route derives it from the token row.
//
// The v2 fields also carry INTERNAL-CONSISTENCY rules, for the same reason
// `runs` is corrected up to `successes + failures` below: these numbers are
// divided against each other on the roster, and a self-reported ledger that
// claims more merges than it opened would render a >100% delivery rate and a ✓
// on a review it never earned. `merged ≤ opened`, `reverted ≤ merged`, the gate
// rate is clamped into 0..1, and counts are floors at 0 — corrected, with the
// period's real spend still landing, rather than the whole row being dropped.

export const AGENT_LIFECYCLE_EVENTS = [
  "approved",
  "onboarding",
  "activated",
  "rejected",
  "retired",
  // v2: the day-N probation decision (concept §2.3 "tenure & feedback"). The
  // event does not itself say what happened — `decision` does, and it is
  // REQUIRED, because a probation review with no decision is not a review.
  "probation_review",
] as const;
export type AgentLifecycleEvent = (typeof AGENT_LIFECYCLE_EVENTS)[number];

/** What a human decided at the probation review. `extended` deliberately has no
 *  new status: the agent stays in onboarding (probation) — "more time" is not a
 *  promotion, and rendering it as one is the dishonest-green this feature's own
 *  rubric forbids. */
export const PROBATION_DECISIONS = ["activated", "extended", "retired"] as const;
export type ProbationDecision = (typeof PROBATION_DECISIONS)[number];

/** Autopilot as Personas runs it per project — probation sits at `suggest`. */
export const AUTOPILOT_MODES = ["off", "measure", "suggest", "full"] as const;
export type AutopilotMode = (typeof AUTOPILOT_MODES)[number];

/** One objective's movement inside its window, as reported. Mirrors
 *  `pipeline/jobfit/appmaster.py::KpiDelta`; `measured:false` is a coverage gap,
 *  never a miss. Baselines and currents may be NEGATIVE (a KPI can be a delta),
 *  so they are bounded as finite-or-null, not as non-negative. */
export type ReportedKpiDelta = {
  kpiKey: string;
  baseline: number | null;
  current: number | null;
  target: number | null;
  direction: "gte" | "lte";
  windowDays: number;
  measured: boolean;
};

/** The v2 backbone block of a rollup. `null` on the report when the sender
 *  reported none of it — which must stay distinguishable from reporting zeroes. */
export type RollupBackbone = {
  proposalsOpened: number;
  proposalsMerged: number;
  proposalsReverted: number;
  gatePassRate: number | null;
  forbiddenClassViolations: number;
  kpiDeltas: ReportedKpiDelta[];
  budgetReservedUsd: number | null;
  budgetSettledUsd: number | null;
  /** True ⇒ spend was NOT metered. `budgetSettledUsd` may still be reported and
   *  is still stored, but it must never be scored as budget adherence — the
   *  backbone withholds the budget rule entirely (appmaster.py `backbone_score`). */
  budgetUnmeasured: boolean;
  ledgerConsistent: boolean | null;
  autopilotMode: AutopilotMode | null;
  /** Persona-memory tier counts for the App-master persona (M3, 2026-08-27) —
   *  the tenure's accumulated experience, made visible to the operator. `null`
   *  when the reporter sent none (older Personas, or an empty/unqueryable
   *  store — the reporter itself sends nothing rather than four zeros). */
  memory: { core: number; active: number; working: number; archived: number } | null;
};

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
  /** v2 — null when the sender reported no backbone reading at all. */
  backbone: RollupBackbone | null;
};

export type LifecycleReport = {
  kind: "lifecycle";
  event: AgentLifecycleEvent;
  personaId: string | null;
  personaName: string | null;
  reason: string | null;
  /** v2 — set (and required) only for `probation_review`. */
  decision: ProbationDecision | null;
  note: string | null;
};

export type AgentReport = ExecutionReport | RollupReport | LifecycleReport;

export type ParseReportResult = { ok: true; report: AgentReport } | { ok: false; error: string };

const MAX_STRING = 200;
const MAX_REASON = 500;
const MAX_CONNECTOR_USES = 50;
// A month of proposals from one agent is a two-digit number; the cap is here so
// a fat-fingered or hostile sender cannot park an absurd denominator on the
// roster, not because 100k is plausible.
const MAX_COUNT = 100_000;
const MAX_KPI_DELTAS = 24;
// A review window is days, not centuries. 3650 = ten years.
const MAX_WINDOW_DAYS = 3650;
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

/** A finite number of ANY sign, else null — for KPI readings, which are not
 *  counts and may legitimately be negative. */
function signed(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A bounded non-negative count. */
function count(v: unknown): number {
  const n = int(v);
  return n === null ? 0 : Math.min(MAX_COUNT, n);
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function kpiDeltas(v: unknown): ReportedKpiDelta[] {
  if (!Array.isArray(v)) return [];
  const out: ReportedKpiDelta[] = [];
  for (const entry of v.slice(0, MAX_KPI_DELTAS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const kpiKey = str(e.kpiKey, 120);
    if (!kpiKey) continue; // a delta with no key can't be matched to an objective
    const window = int(e.windowDays);
    out.push({
      kpiKey,
      baseline: signed(e.baseline),
      current: signed(e.current),
      target: signed(e.target),
      direction: e.direction === "lte" ? "lte" : "gte",
      windowDays: window === null || window <= 0 ? 30 : Math.min(MAX_WINDOW_DAYS, window),
      // A delta with no reading is NOT measured. Defaulting this to true would
      // turn every unreported objective into a scored miss.
      measured: e.measured === true,
    });
  }
  return out;
}

/** The v2 backbone block of a rollup, with its internal-consistency rules
 *  applied. Returns null when the sender reported none of these fields — a
 *  pre-v2 rollup must stay distinguishable from one reporting all zeroes. */
function rollupBackbone(p: Record<string, unknown>): RollupBackbone | null {
  const present =
    ["proposalsOpened", "proposalsMerged", "proposalsReverted", "gatePassRate", "forbiddenClassViolations", "budgetReservedUsd", "budgetSettledUsd"].some(
      (k) => p[k] !== undefined
    ) ||
    Array.isArray(p.kpiDeltas) ||
    typeof p.budgetUnmeasured === "boolean" ||
    typeof p.ledgerConsistent === "boolean" ||
    typeof p.autopilotMode === "string";
  if (!present) return null;

  const opened = count(p.proposalsOpened);
  // merged ≤ opened and reverted ≤ merged: the roster divides these against each
  // other, so a ledger claiming 9 merges out of 5 opens would render a 180%
  // delivery rate. Corrected DOWN to the containing number (a merge implies an
  // open, so the open count is the one that would have to be wrong — and
  // inflating it would invent proposals nobody saw).
  const merged = Math.min(count(p.proposalsMerged), opened);
  const reverted = Math.min(count(p.proposalsReverted), merged);

  const rawRate = signed(p.gatePassRate);
  const gatePassRate = rawRate === null ? null : Math.min(1, Math.max(0, rawRate));

  const reserved = num(p.budgetReservedUsd);
  const settled = num(p.budgetSettledUsd);
  const declaredUnmeasured = bool(p.budgetUnmeasured);
  const mode = typeof p.autopilotMode === "string" && (AUTOPILOT_MODES as readonly string[]).includes(p.autopilotMode)
    ? (p.autopilotMode as AutopilotMode)
    : null;

  return {
    proposalsOpened: opened,
    proposalsMerged: merged,
    proposalsReverted: reverted,
    gatePassRate,
    forbiddenClassViolations: count(p.forbiddenClassViolations),
    kpiDeltas: kpiDeltas(p.kpiDeltas),
    budgetReservedUsd: reserved,
    budgetSettledUsd: settled,
    // "Unmeasured is not free." An explicit flag wins; otherwise a rollup that
    // reported NEITHER number never metered its spend, and saying so is the
    // honest read — the alternative (0 reserved, 0 settled, measured) scores as
    // perfect budget adherence for an agent nobody costed.
    budgetUnmeasured: declaredUnmeasured ?? (reserved === null && settled === null),
    ledgerConsistent: bool(p.ledgerConsistent),
    autopilotMode: mode,
    memory: memoryCounts(p.memory),
  };
}

/** The reporter's memory tier counts — four bounded non-negative ints or null.
 *  A partial/garbled block is dropped whole: half a reading is not a reading. */
function memoryCounts(v: unknown): { core: number; active: number; working: number; archived: number } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const tier = (x: unknown): number | null =>
    typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), 1_000_000) : null;
  const core = tier(o.core), active = tier(o.active), working = tier(o.working), archived = tier(o.archived);
  if (core === null || active === null || working === null || archived === null) return null;
  return { core, active, working, archived };
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
        backbone: rollupBackbone(p),
      },
    };
  }

  if (kind === "lifecycle") {
    const event = (AGENT_LIFECYCLE_EVENTS as readonly string[]).includes(String(p.event))
      ? (p.event as AgentLifecycleEvent)
      : null;
    if (!event) return { ok: false, error: `lifecycle reports require an event in: ${AGENT_LIFECYCLE_EVENTS.join(", ")}.` };
    const decision = (PROBATION_DECISIONS as readonly string[]).includes(String(p.decision))
      ? (p.decision as ProbationDecision)
      : null;
    // A probation review IS its decision — the event alone would move the agent
    // nowhere and leave the roster showing "reviewed" with no outcome. Refused
    // as a shape error (deterministic 400, retryable) rather than defaulted.
    if (event === "probation_review" && !decision) {
      return { ok: false, error: `probation_review requires a decision in: ${PROBATION_DECISIONS.join(", ")}.` };
    }
    return {
      ok: true,
      report: {
        kind: "lifecycle",
        event,
        personaId: str(p.personaId),
        personaName: str(p.personaName),
        reason: str(p.reason, MAX_REASON),
        decision: event === "probation_review" ? decision : null,
        note: str(p.note, MAX_REASON),
      },
    };
  }

  return { ok: false, error: 'kind must be "execution", "rollup" or "lifecycle".' };
}
