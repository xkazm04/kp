import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Phase 3 — data-driven decision rules per pipeline phase, replacing the
// hard-coded Python POLICY for the configurable bits. Isolated connection
// (job-ingest/offers/scheduler pattern) so we don't touch the fork-active db.ts.

const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

// Screening auto-reject: drop the bottom `rejectBottomPercent` of a role's
// matched candidates that are ALSO below `maxMatchToReject` match — never
// early-career. Off by default (opt-in), like the automation clock.
export type ScreeningRule = {
  autoRejectEnabled: boolean;
  rejectBottomPercent: number; // 0–100
  maxMatchToReject: number; // 0–100 match score
};

const DEFAULTS: Record<string, unknown> = {
  screening: { autoRejectEnabled: false, rejectBottomPercent: 20, maxMatchToReject: 45 } as ScreeningRule,
};

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
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
  db()
    .prepare(
      `INSERT INTO decision_config (phase, config_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(phase) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`
    )
    .run(phase, JSON.stringify(config), new Date().toISOString());
}

export function getAllDecisionConfigs(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const phase of Object.keys(DEFAULTS)) out[phase] = getDecisionConfig(phase);
  return out;
}
