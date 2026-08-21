import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH, openStore } from "./db-path";
import { ORG_CONFIG_NOT_PORTABLE, orgExportClass } from "./tenancy";

// DATA3 — the dump/load cores from scripts/db-dump.mjs + db-load.mjs, extracted
// so the workspace export/import API can call them in-process. The .mjs scripts
// keep their own copies (they must stay runnable with bare `node` and can't
// import TS); the FORMAT/VERSION constants and the cell encoding are the shared
// contract — a file produced by either side loads on the other.
//
// Connections: both directions open their OWN better-sqlite3 handle on the
// workspace file rather than reusing the app singleton — the dump wants a
// readonly view, and the load's drop-and-recreate runs in ONE transaction with
// the same WAL + busy_timeout pragmas the scripts use, so it waits for (and is
// atomic under) the app's live connection instead of failing on SQLITE_BUSY.

export const DUMP_FORMAT = "kp-db-dump";
export const DUMP_VERSION = 1;
// The UI export's default exclusions (same as the script's documented --skip
// suggestion): the prompt cache is heavy + rebuildable, tasks are runner state.
export const DEFAULT_EXPORT_SKIP = ["gemini_cache", "tasks"] as const;

export type DumpTable = { name: string; ddl: string; indexes: string[]; columns: string[]; rows: unknown[][] };
export type DumpPayload = {
  format: string;
  version: number;
  createdAt: string;
  sourceDb: string;
  tables: DumpTable[];
};

// JSON-safe cell encoding (mirrors the scripts): BLOBs round-trip as a tagged
// base64 wrapper.
function encodeCell(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $blob: value.toString("base64") };
  return value;
}
function decodeCell(value: unknown): unknown {
  if (value && typeof value === "object" && typeof (value as { $blob?: unknown }).$blob === "string") {
    return Buffer.from((value as { $blob: string }).$blob, "base64");
  }
  return value;
}

// Identifier guard: table/column names from a dump are interpolated into
// quoted DDL/INSERT statements, so only plain identifiers are accepted — a
// crafted name can't escape its quoting. (The dump's DDL strings are executed
// by design — restoring IS running CREATE statements from the file — which is
// exactly why the import endpoint must sit behind the same app-wide auth
// decision as the other recruiter surfaces; see ccb4d851.)
const SAFE_IDENT = /^[A-Za-z0-9_]+$/;

export function dumpWorkspace(skip: ReadonlySet<string> = new Set(DEFAULT_EXPORT_SKIP)): DumpPayload {
  if (!existsSync(DB_PATH)) {
    throw new Error("No workspace database exists yet — start the app and try again.");
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    // Read EVERY table inside ONE transaction so the dump is a CONSISTENT snapshot.
    // Without it, a write by the app's live connection landing between reading table
    // A and table B produces a referentially TORN backup (e.g. a pipeline_event whose
    // entry didn't exist yet when its table was read) — and the export still reports
    // success. In WAL mode the read transaction sees an isolated point-in-time view
    // for its whole duration, so cross-table references stay coherent.
    const collect = db.transaction((): DumpTable[] => {
      const tables = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string; sql: string }[];
      const indexStmt = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name"
      );
      const dumped: DumpTable[] = [];
      for (const t of tables) {
        if (skip.has(t.name) || !SAFE_IDENT.test(t.name)) continue;
        const columns = (db.prepare(`SELECT name FROM pragma_table_info('${t.name}')`).all() as { name: string }[]).map(
          (c) => c.name
        );
        const rows = (db.prepare(`SELECT * FROM "${t.name}"`).raw(true).all() as unknown[][]).map((row) =>
          row.map(encodeCell)
        );
        dumped.push({
          name: t.name,
          ddl: t.sql,
          indexes: (indexStmt.all(t.name) as { sql: string }[]).map((i) => i.sql),
          columns,
          rows,
        });
      }
      return dumped;
    });
    const dumped = collect();
    return {
      format: DUMP_FORMAT,
      version: DUMP_VERSION,
      createdAt: new Date().toISOString(),
      sourceDb: DB_PATH,
      tables: dumped,
    };
  } finally {
    db.close();
  }
}

/** Structural validation of an uploaded dump — returns the typed payload or a
 *  reason string. Identifier-checks every table/column name (see SAFE_IDENT). */
export function coerceDumpPayload(raw: unknown): { ok: true; payload: DumpPayload } | { ok: false; reason: string } {
  const p = raw as DumpPayload | null;
  if (!p || typeof p !== "object") return { ok: false, reason: "Not a JSON object." };
  if (p.format !== DUMP_FORMAT || p.version !== DUMP_VERSION) {
    return { ok: false, reason: `Not a ${DUMP_FORMAT} v${DUMP_VERSION} file.` };
  }
  if (!Array.isArray(p.tables)) return { ok: false, reason: "Dump carries no tables array." };
  for (const t of p.tables) {
    if (!t || typeof t.name !== "string" || !SAFE_IDENT.test(t.name)) {
      return { ok: false, reason: "Dump contains an invalid table name." };
    }
    if (typeof t.ddl !== "string" || !Array.isArray(t.columns) || !Array.isArray(t.rows)) {
      return { ok: false, reason: `Table "${t.name}" is malformed.` };
    }
    if (!t.columns.every((c) => typeof c === "string" && SAFE_IDENT.test(c))) {
      return { ok: false, reason: `Table "${t.name}" has an invalid column name.` };
    }
  }
  return { ok: true, payload: p };
}

export type ImportPlan = {
  tables: { name: string; rows: number; populated: boolean }[];
  /** Tables that already hold rows in the live workspace — loading these
   *  requires the explicit replace authorization (the script's --replace). */
  populated: string[];
};

function openForLoad(): Database.Database {
  // The import target uses the canonical isolated-store open (WAL + busy_timeout):
  // it writes the loaded workspace on its own connection, sharing the kp.sqlite
  // file with the rest of the app.
  return openStore();
}

export function planImport(payload: DumpPayload): ImportPlan {
  const db = openForLoad();
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const tables = payload.tables.map((t) => {
      const populated = tableExists.get(t.name)
        ? ((db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n ?? 0) > 0
        : false;
      return { name: t.name, rows: t.rows.length, populated };
    });
    return { tables, populated: tables.filter((t) => t.populated).map((t) => t.name) };
  } finally {
    db.close();
  }
}

/** All-or-nothing restore (the script's exact semantics): missing/empty tables
 *  always load; a populated table is only touched when `replace` was explicitly
 *  authorized, and the check covers the WHOLE dump up front — either every
 *  table loads or none does. Throws with the populated list when refused. */
export function loadWorkspace(payload: DumpPayload, opts: { replace: boolean }): { name: string; rows: number }[] {
  const db = openForLoad();
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const populated = payload.tables.filter((t) => {
      if (!tableExists.get(t.name)) return false;
      return ((db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get() as { n: number }).n ?? 0) > 0;
    });
    if (populated.length > 0 && !opts.replace) {
      throw new Error(`Refusing to load — these tables already contain rows: ${populated.map((t) => t.name).join(", ")}.`);
    }
    const loadAll = db.transaction(() => {
      const summary: { name: string; rows: number }[] = [];
      for (const t of payload.tables) {
        if (tableExists.get(t.name)) db.exec(`DROP TABLE "${t.name}"`);
        db.exec(t.ddl);
        for (const indexDdl of t.indexes ?? []) {
          if (typeof indexDdl === "string" && indexDdl) db.exec(indexDdl);
        }
        if (t.rows.length > 0) {
          const placeholders = t.columns.map(() => "?").join(", ");
          const insert = db.prepare(
            `INSERT INTO "${t.name}" (${t.columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`
          );
          for (const row of t.rows) insert.run(...row.map(decodeCell));
        }
        summary.push({ name: t.name, rows: t.rows.length });
      }
      return summary;
    });
    return loadAll();
  } finally {
    db.close();
  }
}

// ---- Org-scoped backup ------------------------------------------------------
//
// The whole-database pair above cannot survive multi-tenancy — it reads every table
// with no predicate and restores by DROPping them — so both routes refuse outright
// once KP_MULTI_WORKSPACE is on. This pair replaces them: it backs up ONE
// ORGANIZATION and restores it IN PLACE, into the deployment it came from.
//
// In-place is a deliberate narrowing, not an unfinished half. It is the case the UI
// actually promises (take a backup before a risky bulk action; roll back if it goes
// wrong), and staying in-place is what makes it SAFE to build: the ids are already
// this deployment's, so none of the cross-deployment collisions apply — `org-default`,
// `workspace` and `tpl-standard` are seeded into every deployment, `users.email` is
// globally UNIQUE, and `decision_config`'s org-tier index is UNIQUE on `(phase)` alone
// so two orgs' defaults cannot coexist. The HMAC chains in `decision_records` and
// `skill_profiles` verify after restore for the same reason: same deployment, same key
// material. Moving an org BETWEEN deployments needs all of that re-keyed first, and is
// tracked as a gap in docs/features/organization/README.md.
//
// Two rules the restore never breaks:
//   1. DELETE-by-scope + INSERT, never DROP TABLE. Another org's rows live in these
//      same tables.
//   2. The MANIFEST decides which tables are in scope, not `sqlite_master`. A table
//      nobody classified is a table nobody decided about; enumerating the live schema
//      is exactly how the old dump swept up deployment secrets and the shared corpus.

export const ORG_DUMP_FORMAT = "kp-org-dump";
export const ORG_DUMP_VERSION = 1;

export type OrgDumpPayload = {
  format: string;
  version: number;
  createdAt: string;
  sourceDb: string;
  /** The org this file belongs to. The restore refuses a mismatch: a backup is rolled
   *  back into the org it came from, never sideways into another one. */
  orgId: string;
  /** The org's workspaces at dump time. Recorded so the restore can clear exactly the
   *  scope the file covers, rather than re-deriving it from a DB that has moved on. */
  workspaceIds: string[];
  /** The org's users at dump time — the scope for the tables keyed by user rather than
   *  by tenant (`user_credentials`, and the membership table's user arm). */
  userIds: string[];
  /** Named for the operator, not for the code: config a restore will NOT bring back
   *  (see ORG_CONFIG_NOT_PORTABLE). Carried in the file so the reason survives even
   *  when the file is read on another build. */
  notPortable: string[];
  tables: DumpTable[];
};

/** The row scope of one org: every predicate below is built from these three sets, so
 *  "what belongs to this org" is decided ONCE and cannot drift between the two halves. */
type OrgScope = {
  orgId: string;
  workspaceIds: readonly string[];
  userIds: readonly string[];
  /** Whether the `org_shared` NULL tier is in scope. Always true for a dump (reading it
   *  harms nobody); on restore it is true only when this deployment holds a SINGLE org —
   *  see restoreOrg, where deleting a globally-shared row would hit a bystander. */
  includeSharedTier: boolean;
};

function inClause(ids: readonly string[]): string | null {
  return ids.length > 0 ? ids.map(() => "?").join(", ") : null;
}

/** The WHERE clause + bound parameters for one table's org scope, or null when the
 *  manifest says the table is not the org's to carry. `0 = 1` (rather than an empty
 *  `IN ()`, which is a syntax error) keeps an org with no workspaces or no users
 *  working: it still has identity and billing rows. */
function orgPredicate(table: string, scope: OrgScope): { sql: string; params: unknown[] } | null {
  const cls = orgExportClass(table);
  if (!cls || cls === "exclude") return null;
  const ws = inClause(scope.workspaceIds);
  const users = inClause(scope.userIds);
  switch (cls) {
    case "workspace":
      return ws ? { sql: `workspace_id IN (${ws})`, params: [...scope.workspaceIds] } : { sql: "0 = 1", params: [] };
    case "org_shared": {
      const own = ws ? `workspace_id IN (${ws})` : "0 = 1";
      const params = ws ? [...scope.workspaceIds] : [];
      return scope.includeSharedTier ? { sql: `workspace_id IS NULL OR ${own}`, params } : { sql: own, params };
    }
    case "org":
      // `organizations` is keyed by `id`; every other org-level table by `org_id`.
      return table === "organizations"
        ? { sql: "id = ?", params: [scope.orgId] }
        : { sql: "org_id = ?", params: [scope.orgId] };
    case "by_user":
      return users ? { sql: `user_id IN (${users})`, params: [...scope.userIds] } : { sql: "0 = 1", params: [] };
    case "membership": {
      // Either arm alone silently strips somebody: a membership is the only place a
      // role lives, and this org's user may hold one on another org's team.
      const arms: string[] = [];
      const params: unknown[] = [];
      if (ws) {
        arms.push(`workspace_id IN (${ws})`);
        params.push(...scope.workspaceIds);
      }
      if (users) {
        arms.push(`user_id IN (${users})`);
        params.push(...scope.userIds);
      }
      return arms.length > 0 ? { sql: arms.join(" OR "), params } : { sql: "0 = 1", params: [] };
    }
  }
}

/** Back up one organization: its teams' data, its identity, its billing record. */
export function dumpOrg(orgId: string): OrgDumpPayload {
  if (!existsSync(DB_PATH)) {
    throw new Error("No workspace database exists yet — start the app and try again.");
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    // ONE transaction for the whole read, for the same reason dumpWorkspace uses one:
    // a write landing between two tables produces a referentially TORN backup that
    // still reports success.
    const collect = db.transaction((): OrgDumpPayload => {
      const workspaceIds = (db.prepare(`SELECT id FROM workspaces WHERE org_id = ? ORDER BY id`).all(orgId) as { id: string }[]).map(
        (r) => r.id
      );
      const userIds = (db.prepare(`SELECT id FROM users WHERE org_id = ? ORDER BY id`).all(orgId) as { id: string }[]).map((r) => r.id);
      const scope: OrgScope = { orgId, workspaceIds, userIds, includeSharedTier: true };
      const live = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string; sql: string }[];
      const indexStmt = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name"
      );
      const tables: DumpTable[] = [];
      for (const t of live) {
        if (!SAFE_IDENT.test(t.name)) continue;
        const pred = orgPredicate(t.name, scope);
        if (!pred) continue;
        const stmt = db.prepare(`SELECT * FROM "${t.name}" WHERE ${pred.sql}`);
        const columns = stmt.columns().map((c) => c.name);
        const rows = (stmt.raw(true).all(...pred.params) as unknown[][]).map((row) => row.map(encodeCell));
        tables.push({
          name: t.name,
          ddl: t.sql,
          indexes: (indexStmt.all(t.name) as { sql: string }[]).map((i) => i.sql),
          columns,
          rows,
        });
      }
      return {
        format: ORG_DUMP_FORMAT,
        version: ORG_DUMP_VERSION,
        createdAt: new Date().toISOString(),
        sourceDb: DB_PATH,
        orgId,
        workspaceIds,
        userIds,
        notPortable: [...ORG_CONFIG_NOT_PORTABLE].sort(),
        tables,
      };
    });
    return collect();
  } finally {
    db.close();
  }
}

/** Structural validation of an uploaded org backup — shape only, the same contract
 *  coerceDumpPayload applies to the whole-DB format. Whether the file may be restored
 *  HERE is a separate question, answered by restoreOrg's org check. */
export function coerceOrgDumpPayload(raw: unknown): { ok: true; payload: OrgDumpPayload } | { ok: false; reason: string } {
  const p = raw as OrgDumpPayload | null;
  if (!p || typeof p !== "object") return { ok: false, reason: "Not a JSON object." };
  if (p.format !== ORG_DUMP_FORMAT || p.version !== ORG_DUMP_VERSION) {
    return { ok: false, reason: `Not a ${ORG_DUMP_FORMAT} v${ORG_DUMP_VERSION} file.` };
  }
  if (typeof p.orgId !== "string" || !p.orgId) return { ok: false, reason: "The backup names no organization." };
  for (const key of ["workspaceIds", "userIds"] as const) {
    const list = p[key];
    if (!Array.isArray(list) || !list.every((v) => typeof v === "string")) {
      return { ok: false, reason: `The backup's ${key} list is malformed.` };
    }
  }
  if (!Array.isArray(p.tables)) return { ok: false, reason: "Backup carries no tables array." };
  for (const t of p.tables) {
    if (!t || typeof t.name !== "string" || !SAFE_IDENT.test(t.name)) {
      return { ok: false, reason: "Backup contains an invalid table name." };
    }
    if (!Array.isArray(t.columns) || !Array.isArray(t.rows)) return { ok: false, reason: `Table "${t.name}" is malformed.` };
    if (!t.columns.every((c) => typeof c === "string" && SAFE_IDENT.test(c))) {
      return { ok: false, reason: `Table "${t.name}" has an invalid column name.` };
    }
  }
  return { ok: true, payload: p };
}

/** The scope a restore will CLEAR: the union of what the file covered and what the org
 *  holds today. A rollback means "the org ends up as the file describes", so a team or
 *  account created after the backup is removed with its data — clearing only the file's
 *  scope would strand that team's rows behind a deleted `workspaces` row.
 *
 *  Refuses (rather than skips) an id the file claims that now belongs to ANOTHER org:
 *  skipping would leave the delete out but still insert the file's rows, injecting them
 *  into a bystander's tenant. */
function resolveRestoreScope(db: Database.Database, payload: OrgDumpPayload, orgId: string): OrgScope {
  const claim = (table: "workspaces" | "users", ids: readonly string[]): string[] => {
    const owner = db.prepare(`SELECT org_id FROM ${table} WHERE id = ?`);
    for (const id of ids) {
      const row = owner.get(id) as { org_id: string } | undefined;
      // Absent is fine: the restore re-creates it. Owned by someone else is not.
      if (row && row.org_id !== orgId) {
        throw new Error(
          `Refusing to restore — ${table.slice(0, -1)} "${id}" in this backup now belongs to a different organization.`
        );
      }
    }
    const current = (db.prepare(`SELECT id FROM ${table} WHERE org_id = ?`).all(orgId) as { id: string }[]).map((r) => r.id);
    return [...new Set([...ids, ...current])].sort();
  };
  // A shared-tier row (workspace_id NULL in jd_templates / decision_config) is
  // deployment-global, not org-keyed — the schema literally cannot hold two orgs'
  // versions of it (uq_decision_config_org is UNIQUE on `phase` alone). Restoring it is
  // correct on the single-org deployment KP actually ships as, and would silently reset
  // a bystander org's template library and decision baseline on any other. So: restore
  // it when there is nobody to harm, leave it alone otherwise, and report which.
  const orgCount = Number((db.prepare(`SELECT COUNT(*) AS n FROM organizations`).get() as { n: number }).n ?? 0);
  return {
    orgId,
    workspaceIds: claim("workspaces", payload.workspaceIds),
    userIds: claim("users", payload.userIds),
    includeSharedTier: orgCount <= 1,
  };
}

/** The rows of one dumped table a restore will actually INSERT.
 *
 *  Normally all of them. The one exception is an `org_shared` table (jd_templates,
 *  decision_config) on a deployment that holds ANOTHER org: there `includeSharedTier`
 *  is false, so orgPredicate drops the `workspace_id IS NULL` arm and the delete leaves
 *  the deployment-global tier alone — re-inserting those rows would duplicate them.
 *
 *  Only THAT tier is skipped. Skipping the table wholesale (the shape this used to
 *  have) also dropped the org's OWN team-private rows in the same table, which the
 *  delete had just removed because the predicate's `workspace_id IN (…)` arm matched
 *  them — a restore that reported `inserted: 0` while permanently deleting the org's
 *  team-private template library and decision config.
 *
 *  A file whose columns predate `workspace_id` can't be split into tiers at all (every
 *  row would insert with a NULL workspace_id, i.e. INTO the shared tier), so it is left
 *  alone entirely rather than guessed at. */
function restorableRows(t: DumpTable, scope: OrgScope): unknown[][] {
  if (scope.includeSharedTier || orgExportClass(t.name) !== "org_shared") return t.rows;
  const ws = t.columns.indexOf("workspace_id");
  if (ws < 0) return [];
  return t.rows.filter((row) => row[ws] != null);
}

export type OrgRestoreSummary = {
  tables: { name: string; deleted: number; inserted: number }[];
  /** False when another org shares this deployment, so the shared template/decision
   *  tier was left untouched. Surfaced to the operator, never silent. */
  sharedTierRestored: boolean;
  /** Config the file could not carry — echoed from the payload for the same reason. */
  notRestored: string[];
};

/** Restore an org backup IN PLACE: clear the org's scope, insert the file's rows.
 *  All-or-nothing — one transaction, so a constraint failure anywhere leaves the
 *  database exactly as it was. */
export function restoreOrg(payload: OrgDumpPayload, orgId: string): OrgRestoreSummary {
  if (payload.orgId !== orgId) {
    throw new Error(
      `This backup belongs to a different organization (${payload.orgId}). A backup is restored into the organization it came from.`
    );
  }
  const db = openForLoad();
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const restore = db.transaction((): OrgRestoreSummary => {
      // The schema declares no REFERENCES today, but foreign_keys is ON per connection,
      // so the moment one is migrated in, the alphabetical table order below would break
      // a parent-after-child insert. Deferring to COMMIT costs nothing now and keeps the
      // restore correct then. (Auto-resets when the transaction ends.)
      db.pragma("defer_foreign_keys = ON");
      const scope = resolveRestoreScope(db, payload, orgId);
      const tables: OrgRestoreSummary["tables"] = [];
      for (const t of payload.tables) {
        if (!SAFE_IDENT.test(t.name) || !t.columns.every((c) => SAFE_IDENT.test(c))) {
          throw new Error(`Refusing to restore — unsafe identifier in table "${t.name}".`);
        }
        // A table this build no longer has: its rows have nowhere to go, and creating it
        // from the file's DDL would resurrect a retired schema. Skip, don't guess.
        if (!tableExists.get(t.name)) continue;
        const pred = orgPredicate(t.name, scope);
        if (!pred) continue;
        const deleted = Number(db.prepare(`DELETE FROM "${t.name}" WHERE ${pred.sql}`).run(...pred.params).changes ?? 0);
        let inserted = 0;
        // PER-ROW, never per-table: the out-of-scope shared tier is the NULL-workspace
        // rows alone, and the delete above already cleared everything else this file
        // carries for the table (see restorableRows).
        const rows = restorableRows(t, scope);
        if (rows.length > 0) {
          const cols = t.columns.map((c) => `"${c}"`).join(", ");
          const insert = db.prepare(
            `INSERT INTO "${t.name}" (${cols}) VALUES (${t.columns.map(() => "?").join(", ")})`
          );
          for (const row of rows) {
            insert.run(...row.map(decodeCell));
            inserted += 1;
          }
        }
        tables.push({ name: t.name, deleted, inserted });
      }
      return {
        tables,
        sharedTierRestored: scope.includeSharedTier,
        notRestored: Array.isArray(payload.notPortable) ? payload.notPortable : [...ORG_CONFIG_NOT_PORTABLE].sort(),
      };
    });
    return restore();
  } finally {
    db.close();
  }
}

export type OrgRestorePlan = {
  tables: { name: string; rows: number; existing: number }[];
  totalRows: number;
  /** Rows the restore would DELETE and not replace — the honest headline for the
   *  confirm step, because "12 tables" says nothing about what is about to be lost. */
  totalExisting: number;
  sharedTierRestored: boolean;
};

/** Dry run for the confirm step: per table, how many rows the file carries versus how
 *  many the delete would clear. Never writes. */
export function planOrgRestore(payload: OrgDumpPayload, orgId: string): OrgRestorePlan {
  if (payload.orgId !== orgId) {
    throw new Error(
      `This backup belongs to a different organization (${payload.orgId}). A backup is restored into the organization it came from.`
    );
  }
  const db = openForLoad();
  try {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    const scope = resolveRestoreScope(db, payload, orgId);
    const tables = payload.tables
      .filter((t) => SAFE_IDENT.test(t.name))
      .map((t) => {
        const pred = orgPredicate(t.name, scope);
        const existing =
          pred && tableExists.get(t.name)
            ? Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}" WHERE ${pred.sql}`).get(...pred.params) as { n: number }).n ?? 0)
            : 0;
        // `rows` is what the restore will actually INSERT, not what the file holds —
        // on a multi-org deployment an org_shared table's NULL tier stays out of scope
        // (restorableRows), and a preview that counted it would over-promise.
        return { name: t.name, rows: restorableRows(t, scope).length, existing };
      });
    return {
      tables,
      totalRows: tables.reduce((n, t) => n + t.rows, 0),
      totalExisting: tables.reduce((n, t) => n + t.existing, 0),
      sharedTierRestored: scope.includeSharedTier,
    };
  } finally {
    db.close();
  }
}
