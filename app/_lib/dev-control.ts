import Database from "better-sqlite3";
import { openStore } from "./db-path";
import { DEFAULT_WORKSPACE } from "./auth/session";

// Direction D — oversight & audit, kept in a self-contained connection (its own tables) so
// the autonomous pipeline has an immutable decision log + a kill switch, independent of the
// main schema. WAL lets this second connection share the same DB file safely.
let _db: Database.Database | null = null;
function db(): Database.Database {
  if (_db) return _db;
  // A second connection to the same kp.sqlite file (db.ts + dev-outcomes each open
  // their own) with the canonical isolated-store pragmas (WAL + busy_timeout=5000):
  // when a lifecycle task and an API handler write at once the loser would
  // instantly throw SQLITE_BUSY (default busy_timeout 0) — silently dropping an
  // audit row. The busy_timeout makes a concurrent writer wait briefly instead.
  const d = openStore();
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
  // TENANCY (/perfect wave 21, internal-explorers). `dev_audit` is a declared
  // deployment-level table (app/_lib/tenancy.ts), but its FREE-TEXT payload is not:
  // `outcome_recorded` writes the candidate ref into `reason`, and the control room
  // rendered every row to every operator — so one studio's audit panel listed another
  // studio's candidates. This column attributes a row to the workspace that produced
  // it, and `listAudit` scopes on it.
  const cols = (d.prepare(`PRAGMA table_info(dev_audit)`).all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("workspace_id")) {
    d.exec(`ALTER TABLE dev_audit ADD COLUMN workspace_id TEXT`);
    // Pre-migration rows carry no attribution, and every one of them was written by an
    // install whose whole API was single-tenant — i.e. the default workspace. Backfilling
    // them there keeps a single-tenant deployment's panel exactly as it was, and makes a
    // NEWLY minted tenant start from an empty log rather than inheriting someone else's.
    d.prepare(`UPDATE dev_audit SET workspace_id = ? WHERE workspace_id IS NULL`).run(DEFAULT_WORKSPACE);
  }
  d.exec(`CREATE INDEX IF NOT EXISTS idx_dev_audit_ws ON dev_audit (workspace_id, id DESC)`);
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

/** The DEPLOYMENT-WIDE control events. The kill switch is not one tenant's business:
 *  `autonomy` lives in dev_control, a single global key, so pausing halts every
 *  workspace's orchestrator and every operator has to be able to see that it happened.
 *  Neither row carries candidate data — the payload is "kill switch engaged" — which is
 *  what makes them safe to keep global. Anything not listed here is tenant business and
 *  is scoped by workspace. */
export const GLOBAL_AUDIT_ACTIONS = ["paused", "resumed"] as const;
const GLOBAL_ACTIONS = new Set<string>(GLOBAL_AUDIT_ACTIONS);

/** Append an immutable audit record of an automated or human decision.
 *
 *  `workspaceId` attributes the row to the tenant that produced it. It is OPTIONAL
 *  because most writers (the orchestrator, the pipeline store, offer-finalize) record
 *  without a tenant in hand; an unattributed row falls back to the default workspace,
 *  which is where a single-tenant install's rows have always effectively lived. A
 *  GLOBAL_AUDIT_ACTIONS row is stored unattributed (NULL) on purpose — see above. */
export function recordAudit(input: {
  lifecycleId?: string | null;
  actor: Actor;
  action: string;
  reason?: string;
  ref?: string;
  workspaceId?: string | null;
}): void {
  try {
    db()
      .prepare(`INSERT INTO dev_audit (lifecycle_id, actor, action, reason, ref, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.lifecycleId ?? null,
        input.actor,
        input.action,
        input.reason ?? null,
        input.ref ?? null,
        GLOBAL_ACTIONS.has(input.action) ? null : (input.workspaceId ?? DEFAULT_WORKSPACE),
        new Date().toISOString()
      );
  } catch {
    /* audit must never break the pipeline */
  }
}

/** The control room's audit listing.
 *
 *  SCOPED, not projected: pass the caller's workspace and another tenant's rows never
 *  leave the DB, so no projection has to be trusted to strip a candidate ref out of free
 *  text. The deployment-wide kill-switch rows (GLOBAL_AUDIT_ACTIONS, stored NULL) ride
 *  along for everyone. Omitting `workspaceId` returns the WHOLE log and is for tests and
 *  maintenance scripts only — no request handler may call it that way. */
export function listAudit(limit = 80, workspaceId?: string): AuditEvent[] {
  const rows = (
    workspaceId === undefined
      ? db().prepare(`SELECT * FROM dev_audit ORDER BY id DESC LIMIT ?`).all(limit)
      : db()
          .prepare(`SELECT * FROM dev_audit WHERE workspace_id = ? OR workspace_id IS NULL ORDER BY id DESC LIMIT ?`)
          .all(workspaceId, limit)
  ) as Array<Record<string, unknown>>;
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
  // Fail closed on non-finite input rather than stringifying "NaN" into the store (where it
  // reads back as null and silently reverts to the default floor). Callers validate at the
  // boundary; this is the durable backstop.
  if (!Number.isFinite(value)) throw new Error("promote floor must be a finite number");
  const v = String(Math.max(0, Math.min(100, Math.round(value))));
  db().prepare(`INSERT INTO dev_control (key, value) VALUES ('promote_floor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(v);
}
