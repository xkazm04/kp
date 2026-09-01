import { randomId, randomToken } from "../random-id";
import { ensureDb, safeRowParse } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- Agent-candidate bridge (WP1) -------------------------------------------
//
// KP hires AI agents: a job is transformed into an AgentFitSpec (agent_fit_specs,
// the durable per-job artifact), dispatched to the external Personas app as a
// hired_agents row, and the hired persona reports cost/activity back into
// agent_activity through the token-authed public report route.
//
// Tenancy: every table carries workspace_id and every recruiter-facing query
// filters on it (agents-tenancy.test.ts). The ONE exemption is the report-token
// lookup — the CSPRNG token is the capability on the public inbound endpoint,
// same doctrine as channel_webhooks/offer tokens; the resolved row then supplies
// the workspace every write scopes to (NEVER the payload).

// App master (P4, docs/features/app-master/README.md) adds two columns to
// hired_agents. They live HERE, not in core.ts's shared DDL, for the same reason
// the intake store owns its own (db/intakes.ts): the columns are additive and
// NULL on every pre-existing row, and one owner per table keeps a concurrent
// session's migration out of this diff. Bound to the db INSTANCE so a reset
// connection (tests) re-applies it.
function agentsDb() {
  const d = ensureDb();
  const marked = d as unknown as { __kpHiredAgentsCols?: boolean };
  if (!marked.__kpHiredAgentsCols) {
    for (const col of [
      // The role_intakes row an App-master hire was dispatched FROM. An agent
      // hired for a whole application is composed in the intake dialog, not from
      // a job posting, so it has no job to link to — see the createHiredAgent
      // note on why job_id is empty rather than the table being rebuilt.
      "intake_id TEXT",
      // The AppMasterSpec exactly as it was DISPATCHED (appMasterSpecSchema).
      // Stored on the hire, not read back through the intake, because the intake
      // can be re-composed afterwards and the mandate the agent is actually
      // working under is the one that crossed the wire.
      "app_master_spec_json TEXT",
      // When kp last HEARD from this hire on the public report route — stamped
      // on every authenticated POST, before the body is even read, so a payload
      // that 400s still proves reachability. Deliberately NOT `last_activity_at`
      // (which is derived from ACCEPTED events) and not the bridge's
      // `last_ok_at` (which says kp can reach Personas, the other direction).
      // Without it, "Personas never called" and "Personas is calling and we are
      // rejecting every payload" render identically as silence.
      "last_report_at TEXT",
    ]) {
      try {
        d.exec(`ALTER TABLE hired_agents ADD COLUMN ${col}`);
      } catch {
        /* column already exists — idempotent (core.ts's migrateExec benign path) */
      }
    }
    marked.__kpHiredAgentsCols = true;
  }
  return d;
}

export const AGENT_STATUSES = [
  "dispatched",
  "pending_approval",
  "onboarding",
  "active",
  "rejected",
  "failed",
  "retired",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);
}

export type AgentFitSpecRecord = {
  id: string;
  workspaceId: string;
  jobId: string;
  fit: unknown;
  spec: unknown;
  budget: unknown;
  metrics: unknown;
  source: string;
  createdAt: string;
};

type AgentFitSpecRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  fit_json: string;
  spec_json: string;
  budget_json: string;
  metrics_json: string;
  source: string;
  created_at: string;
};

function rowToFitSpec(r: AgentFitSpecRow): AgentFitSpecRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    jobId: r.job_id,
    fit: safeRowParse<unknown>(r.fit_json, "agentFitSpec.fit", r.id),
    spec: safeRowParse<unknown>(r.spec_json, "agentFitSpec.spec", r.id),
    budget: safeRowParse<unknown>(r.budget_json, "agentFitSpec.budget", r.id),
    metrics: safeRowParse<unknown>(r.metrics_json, "agentFitSpec.metrics", r.id),
    source: r.source,
    createdAt: r.created_at,
  };
}

/** Append one transform result for a job (versioned, never an upsert — see the
 *  core.ts DDL note). The latest row per job is what dispatch reads. */
export function saveAgentFitSpec(
  input: { jobId: string; fit: unknown; spec: unknown; budget: unknown; metrics: unknown; source: string },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): AgentFitSpecRecord {
  const db = agentsDb();
  const id = randomId("afs");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO agent_fit_specs (id, workspace_id, job_id, fit_json, spec_json, budget_json, metrics_json, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.jobId,
    JSON.stringify(input.fit ?? null),
    JSON.stringify(input.spec ?? null),
    JSON.stringify(input.budget ?? null),
    JSON.stringify(input.metrics ?? null),
    input.source,
    now
  );
  return { id, workspaceId, jobId: input.jobId, fit: input.fit, spec: input.spec, budget: input.budget, metrics: input.metrics, source: input.source, createdAt: now };
}

export function getLatestAgentFitSpec(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): AgentFitSpecRecord | null {
  const db = agentsDb();
  const row = db
    .prepare(
      // Tie-break on rowid, NOT id: created_at is an ISO MILLISECOND stamp, and two
      // specs saved back to back (a deterministic draft immediately refined by the
      // LLM pass — the normal path) routinely share one. `id` is randomId(), whose
      // ms-prefix ties then get decided by a Math.random() suffix, so "latest" was a
      // coin flip inside the same millisecond. rowid is monotonic per INSERT, so the
      // row written last always wins. (Caught as an intermittent CI failure of
      // agents-store.test.ts on 2026-08-20.)
      `SELECT * FROM agent_fit_specs WHERE job_id = ? AND workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
    )
    .get(jobId, workspaceId) as AgentFitSpecRow | undefined;
  return row ? rowToFitSpec(row) : null;
}

export type HiredAgentRecord = {
  id: string;
  workspaceId: string;
  /** The job posting this agent was hired against. EMPTY STRING for an App-master
   *  hire dispatched from an intake: owning an application is not a job posting,
   *  and there is nothing to link to. Read `intakeId` in that case. */
  jobId: string;
  jobTitle: string;
  /** The role_intakes row an App-master hire came from, else null. */
  intakeId: string | null;
  /** The dispatched AppMasterSpec (appMasterSpecSchema), else null. Present ⇒
   *  this is an App-master hire. */
  appMaster: unknown;
  personaId: string | null;
  personaName: string | null;
  requestId: string | null;
  status: AgentStatus;
  spec: unknown;
  fit: unknown;
  metrics: unknown;
  budgetUsd: number | null;
  reportToken: string;
  createdAt: string;
  updatedAt: string | null;
  /** When kp last heard from this hire on the report route, whatever the payload
   *  turned out to be. Null ⇒ never heard from. Distinct from the aggregates'
   *  `lastActivityAt`, which only moves when a report is ACCEPTED. */
  lastReportAt: string | null;
};

type HiredAgentRow = {
  id: string;
  workspace_id: string;
  job_id: string;
  job_title: string;
  intake_id: string | null;
  app_master_spec_json: string | null;
  persona_id: string | null;
  persona_name: string | null;
  request_id: string | null;
  status: string;
  spec_json: string;
  fit_json: string | null;
  metrics_json: string | null;
  budget_usd: number | null;
  report_token: string;
  created_at: string;
  updated_at: string | null;
  last_report_at: string | null;
};

function rowToHiredAgent(r: HiredAgentRow): HiredAgentRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    jobId: r.job_id,
    jobTitle: r.job_title,
    intakeId: r.intake_id ?? null,
    appMaster: safeRowParse<unknown>(r.app_master_spec_json, "hiredAgent.appMaster", r.id),
    personaId: r.persona_id,
    personaName: r.persona_name,
    requestId: r.request_id,
    status: (isAgentStatus(r.status) ? r.status : "failed") as AgentStatus,
    spec: safeRowParse<unknown>(r.spec_json, "hiredAgent.spec", r.id),
    fit: safeRowParse<unknown>(r.fit_json, "hiredAgent.fit", r.id),
    metrics: safeRowParse<unknown>(r.metrics_json, "hiredAgent.metrics", r.id),
    budgetUsd: r.budget_usd,
    reportToken: r.report_token,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastReportAt: r.last_report_at ?? null,
  };
}

/** Statuses under which a job's agent is considered live — a second dispatch for
 *  the same job reuses this row instead of duplicating the hire. */
export const ACTIVE_AGENT_STATUSES: readonly AgentStatus[] = ["dispatched", "pending_approval", "onboarding", "active"];

/**
 * Mint a hire. Two origins share this row:
 *
 * * **job** — the shipped agent-fit path: `jobId` names a published job.
 * * **intake** (App master, P4) — `intakeId` names the role_intakes row the
 *   `AppMasterSpec` was composed in, and `jobId` is EMPTY: the agent owns an
 *   application, not a job posting, so there is no job to link and inventing one
 *   would mean starting a paid JD build nobody asked for. `job_id` stays NOT
 *   NULL in the DDL (relaxing it means a full SQLite table rebuild of a table
 *   another session may be writing); the empty string is the disclosed absence,
 *   and every read that navigates to a job checks for it.
 */
export function createHiredAgent(
  input: {
    jobId?: string;
    jobTitle: string;
    intakeId?: string | null;
    appMaster?: unknown;
    spec: unknown;
    fit?: unknown;
    metrics?: unknown;
    budgetUsd?: number | null;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): HiredAgentRecord {
  const db = agentsDb();
  const id = randomId("agent");
  // The ONLY gate on the public report endpoint — CSPRNG, never randomId.
  const token = randomToken("agrpt");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO hired_agents (id, workspace_id, job_id, job_title, intake_id, app_master_spec_json, status, spec_json, fit_json, metrics_json, budget_usd, report_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'dispatched', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    workspaceId,
    input.jobId ?? "",
    input.jobTitle,
    input.intakeId ?? null,
    input.appMaster === undefined || input.appMaster === null ? null : JSON.stringify(input.appMaster),
    JSON.stringify(input.spec ?? null),
    input.fit === undefined ? null : JSON.stringify(input.fit),
    input.metrics === undefined ? null : JSON.stringify(input.metrics),
    input.budgetUsd ?? null,
    token,
    now
  );
  const row = db.prepare(`SELECT * FROM hired_agents WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as HiredAgentRow;
  return rowToHiredAgent(row);
}

export function getHiredAgent(id: string, workspaceId: string = DEFAULT_WORKSPACE_ID): HiredAgentRecord | null {
  const db = agentsDb();
  const row = db.prepare(`SELECT * FROM hired_agents WHERE id = ? AND workspace_id = ?`).get(id, workspaceId) as
    | HiredAgentRow
    | undefined;
  return row ? rowToHiredAgent(row) : null;
}

export function listHiredAgents(workspaceId: string = DEFAULT_WORKSPACE_ID): HiredAgentRecord[] {
  const db = agentsDb();
  const rows = db
    .prepare(`SELECT * FROM hired_agents WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId) as HiredAgentRow[];
  return rows.map(rowToHiredAgent);
}

/** A live (non-terminal) agent for a job, if any — the dispatch idempotency read.
 *  `job_id != ''` because an App-master hire from an intake carries no job, and
 *  without the guard an empty jobId would match every one of them. */
export function getActiveHiredAgentForJob(jobId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): HiredAgentRecord | null {
  const db = agentsDb();
  const row = db
    .prepare(
      `SELECT * FROM hired_agents
        WHERE job_id = ? AND job_id != '' AND workspace_id = ? AND status IN ('dispatched','pending_approval','onboarding','active')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(jobId, workspaceId) as HiredAgentRow | undefined;
  return row ? rowToHiredAgent(row) : null;
}

/** The same idempotency read for an App-master hire: one live agent per INTAKE.
 *  A double-clicked "Dispatch to Personas" must reuse the in-flight hire, not
 *  compose a second App master for the same application. */
export function getActiveHiredAgentForIntake(
  intakeId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): HiredAgentRecord | null {
  const db = agentsDb();
  const row = db
    .prepare(
      `SELECT * FROM hired_agents
        WHERE intake_id = ? AND workspace_id = ? AND status IN ('dispatched','pending_approval','onboarding','active')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(intakeId, workspaceId) as HiredAgentRow | undefined;
  return row ? rowToHiredAgent(row) : null;
}

/** The receive-time lookup for the PUBLIC report route: token is the capability
 *  (workspace comes from the row, never the payload). A retired agent's token is
 *  dead — indistinguishable from one that never existed (both 404), mirroring the
 *  revoked-webhook doctrine in channels.ts. */
export function getHiredAgentByReportToken(token: string): HiredAgentRecord | null {
  const db = agentsDb();
  const row = db
    .prepare(`SELECT * FROM hired_agents WHERE report_token = ? AND status != 'retired'`)
    .get(token) as HiredAgentRow | undefined;
  return row ? rowToHiredAgent(row) : null;
}

/** LIVENESS RECEIPT for the public report route — the inbound twin of the
 *  channels receiver's `recordChannelWebhookReceipt`. Stamped as soon as a live
 *  token resolves, BEFORE the body is read or parsed, so a report that is
 *  rejected for its shape still proves Personas reached kp. Deliberately does
 *  NOT touch `updated_at` (that tracks lifecycle changes) and does not append to
 *  `agent_activity` (that ledger is for reported events). An unknown or retired
 *  token resolves to no row, so nothing is stamped and the 404 stays
 *  indistinguishable. Returns the stamp so the caller can assert on it. */
export function recordAgentReportReceipt(id: string, workspaceId: string, at: string = new Date().toISOString()): string {
  const db = agentsDb();
  db.prepare(`UPDATE hired_agents SET last_report_at = ? WHERE id = ? AND workspace_id = ?`).run(at, id, workspaceId);
  return at;
}

/** Stamp the Personas request id after a successful dispatch (status → pending_approval). */
export function setHiredAgentRequest(id: string, requestId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): void {
  const db = agentsDb();
  db.prepare(
    `UPDATE hired_agents SET request_id = ?, status = 'pending_approval', updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(requestId, new Date().toISOString(), id, workspaceId);
}

export function updateHiredAgentStatus(
  id: string,
  status: AgentStatus,
  opts: { personaId?: string | null; personaName?: string | null } = {},
  workspaceId: string = DEFAULT_WORKSPACE_ID
): HiredAgentRecord | null {
  const db = agentsDb();
  // persona_id/name are FILL-OR-UPDATE on approve/activate (Personas is the
  // authority for its own ids), COALESCE-kept when the event omits them.
  db.prepare(
    `UPDATE hired_agents
        SET status = ?,
            persona_id = COALESCE(?, persona_id),
            persona_name = COALESCE(?, persona_name),
            updated_at = ?
      WHERE id = ? AND workspace_id = ?`
  ).run(status, opts.personaId ?? null, opts.personaName ?? null, new Date().toISOString(), id, workspaceId);
  return getHiredAgent(id, workspaceId);
}

// ---- Activity ledger --------------------------------------------------------

export type ConnectorUse = { connector: string; calls: number };

export type AgentActivityRecord = {
  id: string;
  workspaceId: string;
  hiredAgentId: string;
  kind: "execution" | "rollup" | "lifecycle";
  ts: string;
  execId: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  status: string | null;
  durationMs: number | null;
  connectorUses: ConnectorUse[];
  period: string | null;
  raw: unknown;
};

type AgentActivityRow = {
  id: string;
  workspace_id: string;
  hired_agent_id: string;
  kind: string;
  ts: string;
  exec_id: string | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  status: string | null;
  duration_ms: number | null;
  connector_uses_json: string | null;
  period: string | null;
  raw_json: string | null;
};

function rowToActivity(r: AgentActivityRow): AgentActivityRecord {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    hiredAgentId: r.hired_agent_id,
    kind: r.kind as AgentActivityRecord["kind"],
    ts: r.ts,
    execId: r.exec_id,
    costUsd: r.cost_usd,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    status: r.status,
    durationMs: r.duration_ms,
    connectorUses: safeRowParse<ConnectorUse[]>(r.connector_uses_json, "agentActivity.connectorUses", r.id) ?? [],
    period: r.period,
    raw: safeRowParse<unknown>(r.raw_json, "agentActivity.raw", r.id),
  };
}

/** One execution event. Idempotent by (hired_agent_id, exec_id): a replayed
 *  report is ignored at the DB level (uq_agent_activity_exec). Returns whether a
 *  NEW row was recorded. */
export function recordAgentExecution(
  hiredAgentId: string,
  input: {
    execId: string;
    costUsd?: number | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    status?: string | null;
    durationMs?: number | null;
    connectorUses?: ConnectorUse[];
    raw?: unknown;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { created: boolean } {
  const db = agentsDb();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO agent_activity
         (id, workspace_id, hired_agent_id, kind, ts, exec_id, cost_usd, tokens_in, tokens_out, status, duration_ms, connector_uses_json, raw_json)
       VALUES (?, ?, ?, 'execution', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomId("aact"),
      workspaceId,
      hiredAgentId,
      new Date().toISOString(),
      input.execId,
      input.costUsd ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.status ?? null,
      input.durationMs ?? null,
      JSON.stringify(input.connectorUses ?? []),
      input.raw === undefined ? null : JSON.stringify(input.raw)
    );
  return { created: res.changes > 0 };
}

/** One period rollup (period = "2026-08" or an ISO day). UPSERT by
 *  (hired_agent_id, period) — a re-sent rollup REPLACES the period's figures
 *  (latest wins), mirroring the incrementBillingUsage period-counter shape but
 *  with replace semantics: Personas reports absolutes, not deltas.
 *
 *  Reporter v2's backbone block (`backbone`) rides in `raw_json` beside
 *  runs/successes/failures — the same JSON column those already use, so there is
 *  no migration and a pre-v2 rollup keeps reading exactly as it did. It is
 *  spread flat rather than nested so `backboneFromRollup` can read one object,
 *  and so a rollup with none of it stays distinguishable from one reporting
 *  zeroes (see `hasBackboneFields`). */
export function upsertAgentRollup(
  hiredAgentId: string,
  input: {
    period: string;
    runs?: number | null;
    successes?: number | null;
    failures?: number | null;
    costUsd?: number | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
    connectorUses?: ConnectorUse[];
    /** The v2 backbone fields, already bounded at report-payload.ts. */
    backbone?: Record<string, unknown> | null;
    raw?: unknown;
  },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  const db = agentsDb();
  const now = new Date().toISOString();
  const raw = {
    runs: input.runs ?? null,
    successes: input.successes ?? null,
    failures: input.failures ?? null,
    ...(input.backbone && typeof input.backbone === "object" ? input.backbone : {}),
    ...(typeof input.raw === "object" && input.raw !== null ? input.raw : {}),
  };
  const tx = db.transaction(() => {
    const existing = db
      .prepare(
        `SELECT id FROM agent_activity WHERE hired_agent_id = ? AND period = ? AND kind = 'rollup' AND workspace_id = ?`
      )
      .get(hiredAgentId, input.period, workspaceId) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE agent_activity
            SET ts = ?, cost_usd = ?, tokens_in = ?, tokens_out = ?, connector_uses_json = ?, raw_json = ?
          WHERE id = ? AND workspace_id = ?`
      ).run(
        now,
        input.costUsd ?? null,
        input.tokensIn ?? null,
        input.tokensOut ?? null,
        JSON.stringify(input.connectorUses ?? []),
        JSON.stringify(raw),
        existing.id,
        workspaceId
      );
      return;
    }
    db.prepare(
      `INSERT INTO agent_activity
         (id, workspace_id, hired_agent_id, kind, ts, cost_usd, tokens_in, tokens_out, connector_uses_json, period, raw_json)
       VALUES (?, ?, ?, 'rollup', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomId("aact"),
      workspaceId,
      hiredAgentId,
      now,
      input.costUsd ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      JSON.stringify(input.connectorUses ?? []),
      input.period,
      JSON.stringify(raw)
    );
  });
  tx();
}

/** One lifecycle event row (audit trail beside the status flip on hired_agents). */
export function recordAgentLifecycle(
  hiredAgentId: string,
  input: { event: string; reason?: string | null; raw?: unknown },
  workspaceId: string = DEFAULT_WORKSPACE_ID
): void {
  const db = agentsDb();
  db.prepare(
    `INSERT INTO agent_activity (id, workspace_id, hired_agent_id, kind, ts, status, raw_json)
     VALUES (?, ?, ?, 'lifecycle', ?, ?, ?)`
  ).run(
    randomId("aact"),
    workspaceId,
    hiredAgentId,
    new Date().toISOString(),
    input.event + (input.reason ? `: ${input.reason}` : ""),
    input.raw === undefined ? null : JSON.stringify(input.raw)
  );
}

/** The most recent rollup period for an agent, as the raw stored object. The
 *  App-master roster scores its backbone from this: rollups are absolutes per
 *  period, so "latest period" IS the current review window — summing periods
 *  would blur two windows into a number that describes neither.
 *  Ordered by `period` (lexicographic = chronological for YYYY-MM[-DD]), then
 *  `ts` for a re-sent period. */
export function getLatestAgentRollupRaw(
  hiredAgentId: string,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): { period: string; raw: unknown } | null {
  const db = agentsDb();
  const row = db
    .prepare(
      `SELECT period, raw_json FROM agent_activity
        WHERE hired_agent_id = ? AND workspace_id = ? AND kind = 'rollup' AND period IS NOT NULL
        ORDER BY period DESC, ts DESC, rowid DESC LIMIT 1`
    )
    .get(hiredAgentId, workspaceId) as { period: string; raw_json: string | null } | undefined;
  if (!row) return null;
  return { period: row.period, raw: safeRowParse<unknown>(row.raw_json, "agentActivity.rollupRaw", hiredAgentId) };
}

export function listAgentActivity(
  hiredAgentId: string,
  limit = 50,
  workspaceId: string = DEFAULT_WORKSPACE_ID
): AgentActivityRecord[] {
  const db = agentsDb();
  const rows = db
    .prepare(
      `SELECT * FROM agent_activity WHERE hired_agent_id = ? AND workspace_id = ? ORDER BY ts DESC, id DESC LIMIT ?`
    )
    .all(hiredAgentId, workspaceId, limit) as AgentActivityRow[];
  return rows.map(rowToActivity);
}

// ---- Aggregates -------------------------------------------------------------

export type AgentAggregates = {
  runs: number;
  successes: number;
  failures: number;
  /** successes / runs, 0..1, null when runs = 0. */
  successRate: number | null;
  costUsd: number;
  /** Cost attributed to the CURRENT calendar month (rollup wins over event sums). */
  monthCostUsd: number;
  tokensIn: number;
  tokensOut: number;
  connectors: Record<string, number>;
  lastActivityAt: string | null;
};

const EXEC_SUCCESS = "success";

function currentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

/** Per-agent totals for the roster module. Per calendar month, a ROLLUP row is
 *  authoritative and the month's execution events are ignored (Personas' rollup
 *  is its own dedup'd truth); months without a rollup sum their execution
 *  events. Day-grained rollup periods count toward their month. */
export function getAgentAggregates(hiredAgentId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): AgentAggregates {
  const db = agentsDb();
  const rows = db
    .prepare(`SELECT * FROM agent_activity WHERE hired_agent_id = ? AND workspace_id = ?`)
    .all(hiredAgentId, workspaceId) as AgentActivityRow[];

  const rollupMonths = new Set(
    rows.filter((r) => r.kind === "rollup" && r.period).map((r) => String(r.period).slice(0, 7))
  );

  const agg: AgentAggregates = {
    runs: 0,
    successes: 0,
    failures: 0,
    successRate: null,
    costUsd: 0,
    monthCostUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    connectors: {},
    lastActivityAt: null,
  };
  const month = currentPeriod();

  const addConnectors = (json: string | null) => {
    const uses = safeRowParse<ConnectorUse[]>(json, "agentAggregates.connectors") ?? [];
    for (const u of uses) {
      if (u && typeof u.connector === "string") {
        agg.connectors[u.connector] = (agg.connectors[u.connector] ?? 0) + (Number(u.calls) || 0);
      }
    }
  };

  for (const r of rows) {
    if (!agg.lastActivityAt || r.ts > agg.lastActivityAt) agg.lastActivityAt = r.ts;
    if (r.kind === "rollup" && r.period) {
      const raw = safeRowParse<{ runs?: number; successes?: number; failures?: number }>(r.raw_json, "agentAggregates.rollup", r.id);
      agg.runs += Number(raw?.runs) || 0;
      agg.successes += Number(raw?.successes) || 0;
      agg.failures += Number(raw?.failures) || 0;
      agg.costUsd += r.cost_usd ?? 0;
      agg.tokensIn += r.tokens_in ?? 0;
      agg.tokensOut += r.tokens_out ?? 0;
      if (String(r.period).slice(0, 7) === month) agg.monthCostUsd += r.cost_usd ?? 0;
      addConnectors(r.connector_uses_json);
    } else if (r.kind === "execution") {
      const execMonth = r.ts.slice(0, 7);
      if (rollupMonths.has(execMonth)) continue; // the month's rollup is authoritative
      agg.runs += 1;
      if (r.status === EXEC_SUCCESS) agg.successes += 1;
      else agg.failures += 1;
      agg.costUsd += r.cost_usd ?? 0;
      agg.tokensIn += r.tokens_in ?? 0;
      agg.tokensOut += r.tokens_out ?? 0;
      if (execMonth === month) agg.monthCostUsd += r.cost_usd ?? 0;
      addConnectors(r.connector_uses_json);
    }
  }
  agg.costUsd = Math.round(agg.costUsd * 100) / 100;
  agg.monthCostUsd = Math.round(agg.monthCostUsd * 100) / 100;
  agg.successRate = agg.runs > 0 ? Math.round((agg.successes / agg.runs) * 1000) / 1000 : null;
  return agg;
}
