import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

// Direction D — oversight & audit, kept in a self-contained connection (its own tables) so
// the autonomous pipeline has an immutable decision log + a kill switch, independent of the
// main schema. WAL lets this second connection share the same DB file safely.
const DB_PATH = process.env.KP_DB_PATH ?? path.join(process.cwd(), "data", "kp.sqlite");

let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new Database(DB_PATH);
  d.pragma("journal_mode = WAL");
  d.exec(`
    CREATE TABLE IF NOT EXISTS dev_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lifecycle_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT,
      ref TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dev_audit_created ON dev_audit (id DESC);
    CREATE TABLE IF NOT EXISTS dev_control (key TEXT PRIMARY KEY, value TEXT);
  `);
  _db = d;
  return d;
}

export type Actor = "auto" | "human" | "system";
export type AuditEvent = {
  id: number;
  lifecycleId: string | null;
  actor: string;
  action: string;
  reason: string | null;
  ref: string | null;
  createdAt: string;
};

/** Append an immutable audit record of an automated or human decision. */
export function recordAudit(input: { lifecycleId?: string | null; actor: Actor; action: string; reason?: string; ref?: string }): void {
  try {
    db()
      .prepare(`INSERT INTO dev_audit (lifecycle_id, actor, action, reason, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(input.lifecycleId ?? null, input.actor, input.action, input.reason ?? null, input.ref ?? null, new Date().toISOString());
  } catch {
    /* audit must never break the pipeline */
  }
}

export function listAudit(limit = 80): AuditEvent[] {
  const rows = db().prepare(`SELECT * FROM dev_audit ORDER BY id DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    lifecycleId: (r.lifecycle_id as string) ?? null,
    actor: r.actor as string,
    action: r.action as string,
    reason: (r.reason as string) ?? null,
    ref: (r.ref as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export type Autonomy = "on" | "paused";

/** The kill switch. When "paused", the orchestrator halts auto-advancement. */
export function getAutonomy(): Autonomy {
  const r = db().prepare(`SELECT value FROM dev_control WHERE key = 'autonomy'`).get() as { value?: string } | undefined;
  return r?.value === "paused" ? "paused" : "on";
}

export function setAutonomy(value: Autonomy): void {
  db().prepare(`INSERT INTO dev_control (key, value) VALUES ('autonomy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(value);
}

// The promote floor lives here so the outcome-loop calibration (Direction E) can adjust it —
// a human applies a suggestion and the orchestrator reads it at runtime. Returns null when
// unset (the orchestrator then falls back to its DEV_POLICY default).
export function getPromoteFloor(): number | null {
  const r = db().prepare(`SELECT value FROM dev_control WHERE key = 'promote_floor'`).get() as { value?: string } | undefined;
  const n = Number(r?.value);
  return Number.isFinite(n) ? n : null;
}

export function setPromoteFloor(value: number): void {
  const v = String(Math.max(0, Math.min(100, Math.round(value))));
  db().prepare(`INSERT INTO dev_control (key, value) VALUES ('promote_floor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(v);
}
