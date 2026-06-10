import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH, ensureDbDir } from "./db-path";

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
  ensureDbDir();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return db;
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
