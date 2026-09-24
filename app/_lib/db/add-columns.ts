// ONE additive-column migrator for every store (core.ts's migrateExec and the isolated
// stores that own their own schema).
//
// The shape it replaces was an ADD COLUMN exec wrapped in `catch { /* column already
// exists */ }` — a catch that ALSO absorbed SQLITE_READONLY, SQLITE_FULL,
// SQLITE_IOERR, SQLITE_CORRUPT and (once busy_timeout's 5 s expired under a held write lock)
// SQLITE_BUSY. The store then memoized its connection, so the missing column stayed missing
// for the life of the process and surfaced later as "no such column" in some unrelated
// feature. core.ts's migrateExec was stricter but still decided by MESSAGE TEXT, and every
// warm boot threw-and-caught one SqliteError per ALTER.
//
// The contract here: probe `PRAGMA table_info`, ALTER only what is missing, and throw
// everything else with the table and column named. The one tolerated failure is decided by
// the POST-CONDITION, not by the message: an ALTER that loses a concurrent-boot race to
// another connection raises "duplicate column name", and it is tolerated only when a second
// probe shows the column really is there now (the read→write re-check strategy). Stateless
// on purpose — nothing is memoized, so a failed call is simply retried by the next one.
import type Database from "better-sqlite3";

/** The two methods this module uses; a real better-sqlite3 handle satisfies it, and a test
 *  can pass a fake that throws on demand. */
export type ColumnMigrationDb = Pick<Database.Database, "prepare" | "exec">;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function columnsOf(db: ColumnMigrationDb, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** The column name a definition declares: its first token, e.g. `ttl_days` from
 *  `"ttl_days INTEGER"`. Refused unless it is a plain identifier. */
export function columnNameOf(def: string): string {
  const name = def.trim().split(/\s+/)[0] ?? "";
  if (!IDENT.test(name)) throw new Error(`[db:migrate] addColumns: "${def}" does not start with a plain column name`);
  return name;
}

function describe(error: unknown): { message: string; code: unknown } {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return { message, code };
}

/** Add every column of `defs` that `table` does not have yet; return the names it added
 *  (so a caller's one-time backfill can key on them). A second call on a migrated table
 *  issues no ALTER and returns []. Throws — never swallows — when the table does not
 *  exist or an ALTER fails for any reason other than a lost duplicate-column race. */
export function addColumns(db: ColumnMigrationDb, table: string, defs: readonly string[]): string[] {
  if (!IDENT.test(table)) throw new Error(`[db:migrate] addColumns: "${table}" is not a plain table name`);
  const present = columnsOf(db, table);
  if (present.size === 0) {
    throw new Error(`[db:migrate] addColumns: table ${table} does not exist, so its columns cannot be added`);
  }
  const added: string[] = [];
  for (const def of defs) {
    const name = columnNameOf(def);
    if (present.has(name)) continue;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${def.trim()}`);
    } catch (error) {
      const { message, code } = describe(error);
      // The race: another connection added the column between our probe and our ALTER.
      // Tolerated ONLY when the re-probe confirms the post-condition holds.
      if (/duplicate column name/i.test(message) && columnsOf(db, table).has(name)) {
        present.add(name);
        continue;
      }
      throw Object.assign(new Error(`[db:migrate] ALTER TABLE ${table} ADD COLUMN ${name} failed: ${message}`, { cause: error }), {
        code,
      });
    }
    present.add(name);
    added.push(name);
  }
  return added;
}

/** `ALTER TABLE <t> ADD COLUMN <def>` split into its table and definition; null for any
 *  other statement. Lets core.ts's statement-list migrator route its ALTERs here. */
export function parseAddColumn(sql: string): { table: string; def: string } | null {
  const m = /^\s*ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([\s\S]+?)\s*;?\s*$/i.exec(sql);
  return m ? { table: m[1], def: m[2] } : null;
}
