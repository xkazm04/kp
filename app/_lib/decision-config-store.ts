import Database from "better-sqlite3";
import { openStore } from "./db-path";
import {
  COMPLIANCE_DEFAULT,
  type ComplianceRule,
  DecisionConfigError,
  INTERVIEW_PLAN_DEFAULT,
  PIPELINE_STAGES_DEFAULT,
  SCREENING_DEFAULT,
  validateDecisionConfig,
} from "./decision-config-schema";
import { normalizeRegimeId, type RegimeId } from "./compliance-regimes";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces";

// Phase 3 — data-driven decision rules per pipeline phase, replacing the
// hard-coded Python POLICY for the configurable bits. Isolated connection
// (job-ingest/offers/scheduler pattern) so we don't touch the fork-active db.ts.
//
// The config SHAPE and write-validation live in decision-config-schema.ts (a
// pure, DB-free module) so the contract has one source of truth and can be unit
// tested; this module is just the SQLite persistence around it.

// Re-exported so existing importers (screen-wave.ts, the screen-wave route) keep
// resolving `ScreeningRule` from here.
export type { ScreeningRule } from "./decision-config-schema";

const DEFAULTS: Record<string, unknown> = {
  screening: SCREENING_DEFAULT,
  compliance: COMPLIANCE_DEFAULT,
  interviewPlan: INTERVIEW_PLAN_DEFAULT,
  // The board's column axis. Its default is the shipped board itself — the ONE
  // literal in pipeline-stages.ts — so a workspace that has never touched
  // Settings → Hiring renders exactly what it always did, and the composer can
  // never offer a station the board does not draw.
  pipelineStages: PIPELINE_STAGES_DEFAULT,
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  // Tenant tiers (P2 — the dual-tier shared policy): a config row is either ORG-DEFAULT
  // (workspace_id NULL — the company baseline every team inherits) or a TEAM OVERRIDE
  // (workspace_id = team). The phase can no longer be the sole PK (org + each team may
  // hold the same phase), so uniqueness moves to the two partial indexes below.
  d.exec(`
    CREATE TABLE IF NOT EXISTS decision_config (
      phase TEXT NOT NULL,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      workspace_id TEXT
    );
  `);
  // Rebuild a pre-tier table (phase PRIMARY KEY, no workspace_id): its rows become the
  // ORG-DEFAULT tier (workspace_id NULL), matching the pre-tier "one org policy" behavior.
  const cols = d.prepare(`PRAGMA table_info(decision_config)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "workspace_id")) {
    d.exec(
      `CREATE TABLE decision_config_new (phase TEXT NOT NULL, config_json TEXT NOT NULL, updated_at TEXT NOT NULL, workspace_id TEXT);
       INSERT INTO decision_config_new (phase, config_json, updated_at, workspace_id) SELECT phase, config_json, updated_at, NULL FROM decision_config;
       DROP TABLE decision_config;
       ALTER TABLE decision_config_new RENAME TO decision_config;`
    );
  }
  // One org default per phase; one override per (phase, team).
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_config_org ON decision_config (phase) WHERE workspace_id IS NULL`);
  d.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_config_team ON decision_config (phase, workspace_id) WHERE workspace_id IS NOT NULL`);
  _db = d;
  return d;
}

export function getDecisionConfig<T = Record<string, unknown>>(phase: string, workspaceId: string = DEFAULT_WORKSPACE_ID): T {
  // Cascade: the TEAM's own override wins, else the ORG default, else the code default.
  // ORDER BY puts the team row (workspace_id NOT NULL ⇒ 0) ahead of the org row (NULL ⇒ 1).
  const row = db()
    .prepare(
      `SELECT config_json FROM decision_config WHERE phase = ? AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY (workspace_id IS NULL) ASC LIMIT 1`
    )
    .get(phase, workspaceId) as { config_json: string } | undefined;
  const fallback = (DEFAULTS[phase] ?? {}) as T;
  if (!row) return fallback;
  try {
    return { ...(fallback as object), ...(JSON.parse(row.config_json) as object) } as T;
  } catch {
    return fallback;
  }
}

export function setDecisionConfig(
  phase: string,
  config: Record<string, unknown>,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  scope: "org" | "team" = "team"
): void {
  // Backstop: never persist an unvalidated config, no matter the caller. The
  // route validates first (and returns a 400), but enforcing the schema HERE —
  // at the actual write boundary — guarantees a bad write (out-of-range,
  // wrong-type, stray-key, unknown-phase) can't slip into runScreenWave's math
  // through any other path. The clamped, fully-typed result is what we store.
  const result = validateDecisionConfig(phase, config);
  if (!result.ok) throw new DecisionConfigError(result.error);
  const d = db();
  // familyFloors preservation (family-floors follow-up): the screening row is
  // written WHOLESALE, but most writers (the rules modal) predate familyFloors and
  // simply omit the key — omission means "no opinion", not "clear the overrides".
  // When the validated config carries no familyFloors and THIS TIER's stored row
  // does, carry them forward. An EXPLICIT `familyFloors: {}` still clears (the
  // validator keeps an empty present map), so clearing stays expressible.
  if (result.phase === "screening" && !("familyFloors" in result.config)) {
    const existing = (
      scope === "org"
        ? d.prepare(`SELECT config_json FROM decision_config WHERE phase = ? AND workspace_id IS NULL`).get(result.phase)
        : d.prepare(`SELECT config_json FROM decision_config WHERE phase = ? AND workspace_id = ?`).get(result.phase, workspaceId)
    ) as { config_json: string } | undefined;
    if (existing) {
      try {
        const stored = JSON.parse(existing.config_json) as { familyFloors?: Record<string, number> };
        if (stored.familyFloors && Object.keys(stored.familyFloors).length > 0) {
          (result.config as Record<string, unknown>).familyFloors = stored.familyFloors;
        }
      } catch {
        /* unreadable stored row — nothing to preserve */
      }
    }
  }
  const json = JSON.stringify(result.config);
  const now = new Date().toISOString();
  // Delete-then-insert into EXACTLY one tier (org NULL vs team id) — a clean tiered upsert
  // without an ON CONFLICT partial-index target. In a transaction so a concurrent reader
  // never observes the row missing between the delete and the insert.
  d.transaction(() => {
    if (scope === "org") {
      d.prepare(`DELETE FROM decision_config WHERE phase = ? AND workspace_id IS NULL`).run(result.phase);
      d.prepare(`INSERT INTO decision_config (phase, config_json, updated_at, workspace_id) VALUES (?, ?, ?, NULL)`).run(result.phase, json, now);
    } else {
      d.prepare(`DELETE FROM decision_config WHERE phase = ? AND workspace_id = ?`).run(result.phase, workspaceId);
      d.prepare(`INSERT INTO decision_config (phase, config_json, updated_at, workspace_id) VALUES (?, ?, ?, ?)`).run(result.phase, json, now, workspaceId);
    }
  })();
}

export function getAllDecisionConfigs(workspaceId: string = DEFAULT_WORKSPACE_ID): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const phase of Object.keys(DEFAULTS)) out[phase] = getDecisionConfig(phase, workspaceId);
  return out;
}

/** P1-1 — the workspace's active compliance jurisdiction, normalized (a stale or
 *  hand-edited config can never surface an unknown regime). Server-only; the
 *  candidate disclosure reads it through the public GET /api/compliance. */
export function getActiveRegimeId(workspaceId: string = DEFAULT_WORKSPACE_ID): RegimeId {
  return normalizeRegimeId(getDecisionConfig<ComplianceRule>("compliance", workspaceId).jurisdiction);
}
