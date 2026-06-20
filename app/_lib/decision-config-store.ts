import Database from "better-sqlite3";
import { openStore } from "./db-path";
import {
  COMPLIANCE_DEFAULT,
  type ComplianceRule,
  DecisionConfigError,
  SCREENING_DEFAULT,
  validateDecisionConfig,
} from "./decision-config-schema";
import { normalizeRegimeId, type RegimeId } from "./compliance-regimes";

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
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  const d = openStore();
  d.exec(`
    CREATE TABLE IF NOT EXISTS decision_config (
      phase TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  _db = d;
  return d;
}

export function getDecisionConfig<T = Record<string, unknown>>(phase: string): T {
  const row = db().prepare(`SELECT config_json FROM decision_config WHERE phase = ?`).get(phase) as { config_json: string } | undefined;
  const fallback = (DEFAULTS[phase] ?? {}) as T;
  if (!row) return fallback;
  try {
    return { ...(fallback as object), ...(JSON.parse(row.config_json) as object) } as T;
  } catch {
    return fallback;
  }
}

export function setDecisionConfig(phase: string, config: Record<string, unknown>): void {
  // Backstop: never persist an unvalidated config, no matter the caller. The
  // route validates first (and returns a 400), but enforcing the schema HERE —
  // at the actual write boundary — guarantees a bad write (out-of-range,
  // wrong-type, stray-key, unknown-phase) can't slip into runScreenWave's math
  // through any other path. The clamped, fully-typed result is what we store.
  const result = validateDecisionConfig(phase, config);
  if (!result.ok) throw new DecisionConfigError(result.error);
  db()
    .prepare(
      `INSERT INTO decision_config (phase, config_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(phase) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`
    )
    .run(result.phase, JSON.stringify(result.config), new Date().toISOString());
}

export function getAllDecisionConfigs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const phase of Object.keys(DEFAULTS)) out[phase] = getDecisionConfig(phase);
  return out;
}

/** P1-1 — the workspace's active compliance jurisdiction, normalized (a stale or
 *  hand-edited config can never surface an unknown regime). Server-only; the
 *  candidate disclosure reads it through the public GET /api/compliance. */
export function getActiveRegimeId(): RegimeId {
  return normalizeRegimeId(getDecisionConfig<ComplianceRule>("compliance").jurisdiction);
}
